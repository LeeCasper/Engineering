#!/usr/bin/env bash
#
# 部署脚本的沙箱联调测试：模拟「新版本探活失败 → 自动回滚 → 隔离 → 新提交恢复」。
#
# 所有副作用（systemctl / npm / pnpm / curl / journalctl）都 stub 到临时目录，
# 不会碰真实服务、真实数据库，也不需要 root。
#
# 用法：bash deploy/test-deploy-rollback.sh

set -uo pipefail

REPO_DIR=$(cd "$(dirname "$0")/.." && pwd)
DEPLOY_SCRIPT="$REPO_DIR/deploy/renovation-deploy.sh"

ROOT=$(mktemp -d "${TMPDIR:-/tmp}/deploy-rollback.XXXXXX")
cleanup() { rm -rf "$ROOT"; }
trap cleanup EXIT

BIN="$ROOT/bin"
mkdir -p "$BIN" "$ROOT/reports"

fail=0
ok() { echo "  ✓ $*"; }
no() { echo "  ✗ $*"; fail=$((fail + 1)); }

# ── stub 命令：把系统副作用换成本地日志 ──
cat > "$BIN/sudo" <<'EOF'
#!/usr/bin/env bash
# 忽略 -u <user> 与 --，直接以当前用户执行
while [ $# -gt 0 ]; do
  case "$1" in
    -u) shift 2 ;;
    --) shift; break ;;
    *) break ;;
  esac
done
exec "$@"
EOF

for cmd in systemctl npm pnpm journalctl; do
  cat > "$BIN/$cmd" <<EOF
#!/usr/bin/env bash
echo "$cmd \$*" >> "\$SIM_LOG"
exit 0
EOF
done

# 就绪探针：当前 HEAD 是坏提交就返回 503（curl -f → 退出 22）；
# 企业微信 webhook 则校验 JSON 是否可解析。
cat > "$BIN/curl" <<'EOF'
#!/usr/bin/env bash
url=""
payload=""
prev=""
for a in "$@"; do
  case "$a" in http*) url=$a ;; esac
  [ "$prev" = "-d" ] && payload=$a
  prev=$a
done

if [ "$url" = "$SIM_HEALTH_URL" ]; then
  head=$(git -C "$SIM_APP" rev-parse HEAD)
  [ "$head" = "$SIM_BAD_SHA" ] && { echo "unhealthy" >&2; exit 22; }
  echo '{"code":0,"data":{"checks":{"database":true}}}'
  exit 0
fi

if [ -n "$payload" ]; then
  echo "curl-notify $url" >> "$SIM_LOG"
  if command -v node >/dev/null 2>&1; then
    node -e 'JSON.parse(process.argv[1])' "$payload" 2>/dev/null \
      && echo "notify-json-ok" >> "$SIM_LOG" \
      || echo "notify-json-broken" >> "$SIM_LOG"
  fi
fi
exit 0
EOF
chmod +x "$BIN"/*

export PATH="$BIN:$PATH"
export SIM_APP="$ROOT/app"
export SIM_LOG="$ROOT/sim.log"
export SIM_HEALTH_URL="http://127.0.0.1:3100/api/v1/health"
: > "$SIM_LOG"

# ── 造一个带 origin 的沙箱仓库 ──
git init -q --bare "$ROOT/remote.git"
git clone -q "$ROOT/remote.git" "$ROOT/app" 2>/dev/null
cd "$ROOT/app" || exit 1
git config user.email sim@example.com
git config user.name sim
git symbolic-ref HEAD refs/heads/main
mkdir -p server admin/dist
echo '{"name":"sim"}' > server/package.json
echo '<html></html>' > admin/dist/index.html
git add -A && git commit -qm "c1: 初始版本"
git push -q origin main
SHA1=$(git rev-parse HEAD)

echo '{"name":"sim2"}' > server/package.json
git add -A && git commit -qm "c2: 探活会失败的提交"
git push -q origin main
SHA2=$(git rev-parse HEAD)
git tag "ci-green/$SHA2" "$SHA2" && git push -q origin "ci-green/$SHA2"
export SIM_BAD_SHA="$SHA2"

# 场景起点：线上跑着 SHA1，成功标记也指向 SHA1
echo "$SHA1" > "$ROOT/deployed"
: > "$ROOT/failed"

export APP_DIR="$ROOT/app"
export MARKER_FILE="$ROOT/deployed"
export FAILED_FILE="$ROOT/failed"
export LOCK_FILE="$ROOT/lock"
export REPORT_DIR="$ROOT/reports"
export REPORT_MARKER="$ROOT/report-marker"
export WECOM_WEBHOOK="https://example.invalid/wecom-hook"
export HEALTH_RETRIES=2
export HEALTH_INTERVAL=0

run_deploy() { # OUTPUT_FILE
  set +e
  bash "$DEPLOY_SCRIPT" > "$1" 2>&1
  local rc=$?
  set -e
  return "$rc"
}

echo
echo "第一轮：新提交探活失败 → 回滚到 ${SHA1:0:7}"
if run_deploy "$ROOT/run1.out"; then no "应非零退出，实际 0"; else ok "退出码非零"; fi
[ "$(cat "$MARKER_FILE" 2>/dev/null)" = "$SHA1" ] && ok "成功标记回到 ${SHA1:0:7}" \
  || no "标记错误：$(cat "$MARKER_FILE" 2>/dev/null)"
[ "$(cat "$FAILED_FILE" 2>/dev/null)" = "$SHA2" ] && ok "坏提交已隔离" \
  || no "隔离文件错误：$(cat "$FAILED_FILE" 2>/dev/null)"
[ "$(git -C "$SIM_APP" rev-parse HEAD)" = "$SHA1" ] && ok "工作区已回滚" || no "工作区未回滚"
grep -qF "回滚到 ${SHA1:0:7}" "$ROOT/run1.out" && ok "日志含回滚记录" || no "日志缺回滚记录"
grep -qF "systemctl restart renovation-api" "$SIM_LOG" && ok "重启了服务" || no "没有重启服务"
grep -qF "notify-json-ok" "$SIM_LOG" && ok "告警已发送且 JSON 合法" || no "告警未发送或 JSON 非法"

echo
echo "第二轮：同一坏提交 → 隔离跳过，不再重启"
before=$(grep -c 'systemctl restart' "$SIM_LOG")
if run_deploy "$ROOT/run2.out"; then ok "干净退出"; else no "应退出 0"; fi
grep -qF "已隔离" "$ROOT/run2.out" && ok "日志含隔离说明" || no "日志缺隔离说明"
after=$(grep -c 'systemctl restart' "$SIM_LOG")
[ "$before" = "$after" ] && ok "没有再次重启服务" || no "又重启了 $((after - before)) 次"

echo
echo "第三轮：出现新提交 → 正常部署并清除隔离"
git -C "$SIM_APP" reset --hard -q "$SHA2"
echo '{"name":"sim3"}' > "$SIM_APP/server/package.json"
git -C "$SIM_APP" add -A && git -C "$SIM_APP" commit -qm "c3: 修复"
git -C "$SIM_APP" push -q origin main
SHA3=$(git -C "$SIM_APP" rev-parse HEAD)
git -C "$SIM_APP" tag "ci-green/$SHA3" "$SHA3" && git -C "$SIM_APP" push -q origin "ci-green/$SHA3"
if run_deploy "$ROOT/run3.out"; then ok "部署成功"; else no "应部署成功"; fi
[ "$(cat "$MARKER_FILE" 2>/dev/null)" = "$SHA3" ] && ok "成功标记更新到 ${SHA3:0:7}" \
  || no "标记错误：$(cat "$MARKER_FILE" 2>/dev/null)"
[ ! -f "$FAILED_FILE" ] && ok "隔离标记已清除" || no "隔离标记未清除"

echo
if [ "$fail" -eq 0 ]; then
  echo '全部通过'
else
  echo "失败 $fail 项"
  for f in run1 run2 run3; do
    echo "--- ${f}.out"; tail -20 "$ROOT/$f.out"
  done
  # 失败时保留现场，方便排查
  trap - EXIT
  echo "沙箱保留在：$ROOT"
fi
[ "$fail" -eq 0 ]
