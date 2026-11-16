#!/usr/bin/env bash
#
# 服务器端拉取式部署（CD）。
#
# 由 renovation-deploy.timer 每 5 分钟调用一次，也可以手动执行。
# 判定标准只有一个：origin/main 的 HEAD 变了就部署，没变就立即退出。
# 连续执行是安全的 —— flock 保证同一时间只有一个部署在跑。
#
# 为什么是「服务器拉取」而不是「GitHub Actions 推送」：
# 这台服务器已经有仓库的只读访问权限，不需要把部署私钥再放进 GitHub Secrets；
# 代价是部署延迟最多一个 timer 周期，对当前项目可以接受。
#
# 部署顺序刻意做成「先代码、再依赖、再迁移、最后重启」：
# 任何一步失败都会在重启之前退出，线上继续跑旧进程，不会出现
# 「代码已是新的、依赖还是旧的」这种半截状态。
#
# ── 失败处理（2026-11 补） ──
# 重启后的探活用的是**就绪探针** `/api/v1/health`（真 ping MySQL），不是只证明进程活着的
# `/health`。新版本探活失败时：
#   1. 把失败提交写进隔离文件，timer 下一轮不再重试它（否则每 5 分钟重启一次坏代码，
#      服务会一直不可用 —— origin/main 没变，脚本会一遍遍部署同一个坏版本）；
#   2. 回滚到「上一次成功部署的提交」，按需重装后端依赖、重建管理后台，再重启；
#   3. 回滚后仍不健康就停下并告警，等人工介入。
# 迁移**不回滚**：迁移是前向的，代码回滚后新库结构仍然保留，这是刻意选择。
#
# 告警走企业微信群机器人（与 CI 同一个 WECOM_WEBHOOK），未配置时只记日志。

set -Eeuo pipefail

APP_DIR=${APP_DIR:-/srv/renovation/app}
BRANCH=${BRANCH:-main}
OWNER=${OWNER:-renovation}
LOCK_FILE=${LOCK_FILE:-/var/lock/renovation-deploy.lock}
# 记录「上一次成功部署到的提交」。它不是 git 跟踪的文件，避免 reset 时被清掉。
# 上一轮如果在 reset 之后、重启之前失败，工作区已经是新代码、进程却还是旧的；
# 只比较 OLD..NEW 会漏掉这段差异，导致后端一直不重启。用它作为 diff 的起点。
MARKER_FILE=${MARKER_FILE:-/srv/renovation/.deployed-commit}
# 部署失败并被回滚的提交。存在这里之后，timer 不会再重试同一个提交；
# 出现新的 main 提交或人工清空该文件后恢复。DEPLOY_FORCE=1 可临时绕过。
FAILED_FILE=${FAILED_FILE:-/srv/renovation/.failed-commit}
# CI 生成的 Allure 报告会被推到 gh-pages 分支；这里把它同步成站点上的静态目录，
# 让国内网络不用翻墙也能打开（github.io 在很多网络下是打不开的）
REPORT_DIR=${REPORT_DIR:-/srv/renovation/reports}
REPORT_MARKER=${REPORT_MARKER:-/srv/renovation/.report-commit}
REPORT_BRANCH=${REPORT_BRANCH:-gh-pages}
# 就绪探针：/api/v1/health 会真的 ping MySQL，DB 不可用时返回 503。
# 不要换回 /health —— 那只是存活探针，进程活着但连不上库也会 200。
HEALTH_URL=${HEALTH_URL:-http://127.0.0.1:3100/api/v1/health}
HEALTH_RETRIES=${HEALTH_RETRIES:-20}
HEALTH_INTERVAL=${HEALTH_INTERVAL:-2}
NODE_OPTIONS=${NODE_OPTIONS:---max-old-space-size=2048}
DEPLOY_FORCE=${DEPLOY_FORCE:-0}

# 手动执行时也能拿到告警地址；systemd 下由 unit 的 EnvironmentFile 注入。
# 文件可能不存在（这台机器只跑 CI 告警），因此失败不报错。
if [ -z "${WECOM_WEBHOOK:-}" ] && [ -r /etc/renovation/deploy.env ]; then
  # shellcheck disable=SC1091
  . /etc/renovation/deploy.env || true
fi
WECOM_WEBHOOK=${WECOM_WEBHOOK:-}

log() { echo "[deploy $(date '+%F %T')] $*"; }

# ── 纯决策函数（可被 deploy/test-deploy-lib.sh 直接测） ──

# 是否需要部署：工作区或成功标记任一不等于目标提交
should_deploy() { # OLD NEW DEPLOYED
  [ "$1" != "$2" ] || [ "$3" != "$2" ]
}

# 该提交是否已被隔离（上次部署失败并回滚过）
is_quarantined() { # FAILED NEW FORCE
  [ -n "$1" ] && [ "$1" = "$2" ] && [ "$3" != "1" ]
}

# 回滚目标：优先「上一次成功部署」，其次回滚前的工作区；都不能等于失败提交
choose_rollback_target() { # DEPLOYED OLD NEW
  if [ -n "$1" ] && [ "$1" != "$3" ]; then
    printf '%s' "$1"
  elif [ -n "$2" ] && [ "$2" != "$3" ]; then
    printf '%s' "$2"
  fi
}

# JSON 字符串转义：换行压平成空格，反斜杠与双引号转义。
# 只用于企业微信 markdown 的 content，内容全部来自脚本自身（sha / 路径 / 日志行）。
json_escape() {
  printf '%s' "$1" | tr '\n' ' ' | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

# 企业微信告警。任何失败都只记日志，不改变部署结论。
notify() { # TITLE BODY
  if [ -z "$WECOM_WEBHOOK" ]; then
    log "未配置 WECOM_WEBHOOK，跳过告警：$1"
    return 0
  fi

  local content payload
  content=$(printf '## %s\n> %s\n> 主机：%s\n> 时间：%s\n> [部署日志](file:///var/log/renovation/deploy.log)' \
    "$1" "$2" "$(hostname)" "$(date '+%F %T')")
  payload=$(printf '{"msgtype":"markdown","markdown":{"content":"%s"}}' "$(json_escape "$content")")

  curl -fsS --max-time 10 -H 'Content-Type: application/json' \
    -d "$payload" "$WECOM_WEBHOOK" >/dev/null 2>&1 \
    || log "企业微信告警发送失败（不影响部署结论）"
}

# 任何未被 `if`/`||` 兜住的失败都会走到这里：先告警再退出。
# exit 1 本身不触发 ERR，因此下面的告警不会重复发送。
on_error() {
  local line=$1
  log "部署在 ${line} 行中断"
  notify "❌ 部署中断" "脚本在第 ${line} 行失败，线上可能仍是旧版本，请查看部署日志。"
}

# ── 只有直接执行时才继续；测试脚本以 DEPLOY_LIB_ONLY=1 source 本文件 ──
if [ "${DEPLOY_LIB_ONLY:-0}" = "1" ]; then
  return 0
fi

# 放在「lib only」之后：source 本文件做单测时不应该在测试进程里装 ERR trap
trap 'on_error $LINENO' ERR

# 同一时间只允许一个部署。抢不到锁说明上一轮还在跑，本轮直接退出
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  log "已有部署在运行，本轮退出"
  exit 0
fi

cd "$APP_DIR"

# 仓库与依赖都属于 renovation。以 root 执行 git/npm 会把源码改成 root 属主，
# 之后 renovation 再跑 npm 就会 permission denied
run_as_owner() { sudo -u "$OWNER" -- "$@"; }

# 把 gh-pages 上的 Allure 报告同步到本机静态目录（nginx 的 /reports/）。
# 与主分支是否变化无关，因此放在「已是最新」提前退出之前执行。
# 用提交号做标记，报告没更新时不重复解包。
sync_report() {
  run_as_owner git -C "$APP_DIR" fetch --quiet --force origin \
    "refs/heads/$REPORT_BRANCH:refs/remotes/origin/$REPORT_BRANCH" 2>/dev/null || return 0

  local sha
  sha=$(run_as_owner git -C "$APP_DIR" rev-parse "refs/remotes/origin/$REPORT_BRANCH" 2>/dev/null || true)
  [ -z "$sha" ] && return 0
  if [ "$(cat "$REPORT_MARKER" 2>/dev/null || true)" = "$sha" ]; then
    return 0
  fi

  local tmp="$REPORT_DIR/.tmp"
  rm -rf "$tmp"
  mkdir -p "$tmp"
  if ! run_as_owner git -C "$APP_DIR" archive "refs/remotes/origin/$REPORT_BRANCH" | tar -x -C "$tmp"; then
    rm -rf "$tmp"
    log "测试报告解包失败，保留旧报告"
    return 0
  fi

  rm -rf "$REPORT_DIR/latest"
  mv "$tmp" "$REPORT_DIR/latest"
  chmod -R a+rX "$REPORT_DIR"
  echo "$sha" > "$REPORT_MARKER"
  log "测试报告已同步：${sha:0:7}"
}

# 轮询就绪探针。curl -f 把 4xx/5xx 当失败，因此 503（DB 不可用）不会误判为成功。
wait_healthy() {
  local i
  for i in $(seq 1 "$HEALTH_RETRIES"); do
    if curl -fsS --max-time 3 "$HEALTH_URL" >/dev/null 2>&1; then
      log "就绪探针通过（第 ${i} 次，${HEALTH_URL}）"
      return 0
    fi
    sleep "$HEALTH_INTERVAL"
  done
  log "就绪探针失败：${HEALTH_URL} 连续 $((HEALTH_RETRIES * HEALTH_INTERVAL)) 秒不可用"
  return 1
}

# 重启后端并等待就绪。
#
# 不能只看 `systemctl restart` 的退出码，也不能只看就绪探针（BZGGCB-17）：
# 本函数是在 `if restart_and_probe` / `if rollback_and_probe` 里被调用的，
# `set -e` 在 if 上下文不生效，restart 的失败会被静默吞掉；而重启失败时
# 旧进程仍在服务，探针照样返回 200 —— 坏部署被写成成功，timer 下一轮判
# 「已是最新」不再重试，新代码永远不生效且没有告警。
#
# 判定标准改成「进程有没有真的被换掉」：
#   - 重启后主进程号没变且进程仍在 → 旧进程还在服务，判失败（不看退出码）；
#   - 退出码非 0 且读不到进程号 / 进程已不在 → 判失败；
#   - 进程号确实变了但命令报错 → 新进程已在跑，交给就绪探针，不白回滚一次；
#   - 其余情况 → 等就绪探针。
restart_and_probe() {
  log "重启 renovation-api"
  local before after rc=0
  # 服务未运行时 systemctl 返回 0（不是空串），下面按「0 表示没有进程」处理
  before=$(systemctl show -p MainPID --value renovation-api 2>/dev/null || true)
  systemctl restart renovation-api || rc=$?
  after=$(systemctl show -p MainPID --value renovation-api 2>/dev/null || true)

  if [ -n "$after" ] && [ "$after" != "0" ] && [ "$after" = "$before" ]; then
    log "重启失败：旧进程仍在服务（主进程号 ${before} 未变，systemctl restart 退出码 ${rc}），判部署失败"
    return 1
  fi

  if [ "$rc" -ne 0 ] && { [ -z "$before" ] || [ -z "$after" ] || [ "$after" = "0" ]; }; then
    log "重启失败：systemctl restart 退出码 ${rc}，判部署失败"
    return 1
  fi

  if [ "$rc" -ne 0 ]; then
    log "systemctl restart 返回 ${rc}，但主进程号已变化（${before} -> ${after}），以就绪探针为准"
  fi

  wait_healthy
}

mark_success() { # SHA
  echo "$1" > "$MARKER_FILE"
  # 成功部署了一个新提交，之前被隔离的失败提交就不再需要拦住新一轮了
  rm -f "$FAILED_FILE"
}

# 回滚到上一个已知健康的提交。
#
# 迁移不回滚：迁移是前向的，代码回滚后新库结构仍然保留。因此这里只处理
# 「代码 + 依赖 + 管理后台产物」，不执行 `migrate` 的逆向操作。
rollback_and_probe() { # TARGET BROKEN
  local target=$1 broken=$2 changed

  echo "$broken" > "$FAILED_FILE"
  log "回滚到 ${target:0:7}（失败提交 ${broken:0:7} 已隔离）"

  run_as_owner git -C "$APP_DIR" reset --hard --quiet "$target"

  # 按「目标..失败提交」的差异决定要补哪些构建步骤。
  # 方向无所谓，只需要文件名清单。
  changed=$(run_as_owner git -C "$APP_DIR" diff --name-only "$target" "$broken" || true)

  if echo "$changed" | grep -qE '^server/package(-lock)?\.json$'; then
    log "回滚涉及后端依赖，执行 npm ci"
    run_as_owner npm --prefix "$APP_DIR/server" ci --omit=dev --no-audit --no-fund
  fi

  if echo "$changed" | grep -q '^admin/' || [ ! -f "$APP_DIR/admin/dist/index.html" ]; then
    log "回滚涉及管理后台，重新构建"
    if [ ! -d "$APP_DIR/admin/node_modules" ] || echo "$changed" | grep -q '^admin/pnpm-lock\.yaml$'; then
      NODE_OPTIONS="$NODE_OPTIONS" pnpm --dir "$APP_DIR/admin" install --frozen-lockfile
    fi
    NODE_OPTIONS="$NODE_OPTIONS" pnpm --dir "$APP_DIR/admin" build
    chmod -R a+rX "$APP_DIR/admin/dist"
  fi

  restart_and_probe
}

# 部署失败：能回滚就回滚，回滚后再探活；任何结果都以非零退出（systemd 标 failed）。
handle_failure() { # NEW DEPLOYED OLD
  local new=$1 deployed=$2 old=$3 target

  log "新版本重启或就绪检查失败，准备回滚"
  journalctl -u renovation-api -n 50 --no-pager || true

  target=$(choose_rollback_target "$deployed" "$old" "$new")

  # 没有可回滚的提交（首次部署就失败）：隔离坏提交，停下等人工
  if [ -z "$target" ] || ! run_as_owner git -C "$APP_DIR" cat-file -e "${target}^{commit}" 2>/dev/null; then
    echo "$new" > "$FAILED_FILE"
    log "无法回滚：没有可用的历史提交，提交 ${new:0:7} 已隔离，服务不可用，等待人工介入"
    notify "❌ 部署失败且无法回滚" "提交 ${new:0:7} 重启或就绪检查失败，且没有可回滚的历史提交；服务当前不可用，需要人工介入。"
    exit 1
  fi

  if rollback_and_probe "$target" "$new"; then
    # 回滚后的代码就是正在运行的版本，标记同步成它，避免下一轮误判「未部署完成」。
    # 这里**不能**调 mark_success —— 它会清掉隔离文件，而失败提交必须留着，
    # 否则 timer 下一轮又把同一份坏代码装一遍。
    echo "$target" > "$MARKER_FILE"
    log "已回滚到 ${target:0:7} 并探活通过，服务恢复；失败提交 ${new:0:7} 已隔离"
    notify "⚠️ 部署失败，已自动回滚" "提交 ${new:0:7} 重启或就绪检查失败，已回滚到 ${target:0:7}；该提交已隔离，等待新的 main 提交。"
    exit 1
  fi

  # 日志必须自己写出结论：告警正文直接链到 deploy.log，点进去只看得到两条
  # 「就绪探针失败」，读者得自己推断脚本最后停在哪。结论行由脚本补齐。
  log "回滚后仍不健康：服务不可用，等待人工介入（回滚目标 ${target:0:7}，失败提交 ${new:0:7}）"
  notify "❌ 回滚后仍不健康" "提交 ${new:0:7} 失败，回滚到 ${target:0:7} 后仍无法通过就绪检查；服务不可用，需要人工介入。"
  exit 1
}

sync_report

OLD=$(run_as_owner git -C "$APP_DIR" rev-parse HEAD)
# --tags：ci-green 标签是 CI 全绿后才打上的，部署前必须能看到
run_as_owner git -C "$APP_DIR" fetch --quiet --tags origin "$BRANCH"
NEW=$(run_as_owner git -C "$APP_DIR" rev-parse "origin/$BRANCH")
DEPLOYED=$(cat "$MARKER_FILE" 2>/dev/null || true)
FAILED=$(cat "$FAILED_FILE" 2>/dev/null || true)

# 「已是新代码」不等于「已经部署完成」：上一轮可能在 reset 之后、重启之前失败。
# 只有工作区（OLD）与成功标记（DEPLOYED）都等于 NEW，才算真的没事可做
if ! should_deploy "$OLD" "$NEW" "$DEPLOYED"; then
  log "已是最新（${NEW:0:7}），无需部署"
  exit 0
fi

# 隔离闸门：这个提交上次部署失败并回滚过。origin/main 没变，重试只会把坏代码
# 再装一遍 —— 每 5 分钟重启一次，服务持续不可用。等新的 main 提交或人工解除。
if is_quarantined "$FAILED" "$NEW" "$DEPLOY_FORCE"; then
  log "提交 ${NEW:0:7} 已隔离（上次部署失败并回滚），跳过本轮；清除 $FAILED_FILE 或设置 DEPLOY_FORCE=1 可重试"
  exit 0
fi

# CI 闸门：只有三个 job 全绿、由 workflow 打过 ci-green/<sha> 标签的提交才允许部署。
# 标签还没出现说明 CI 仍在跑或已经失败 —— 保留线上旧版本，等下一轮 timer 再看
if ! run_as_owner git -C "$APP_DIR" rev-parse -q --verify "refs/tags/ci-green/${NEW}" > /dev/null; then
  log "CI 未通过或尚未完成：缺少 ci-green/${NEW:0:7} 标签，跳过本轮"
  exit 0
fi

log "发现新提交 ${OLD:0:7} -> ${NEW:0:7}"

# diff 的起点用「上次成功部署的提交」；没有标记（首次部署）时退回 OLD
BASE=$OLD
if [ -n "$DEPLOYED" ] && run_as_owner git -C "$APP_DIR" cat-file -e "${DEPLOYED}^{commit}" 2>/dev/null; then
  BASE=$DEPLOYED
fi
CHANGED=$(run_as_owner git -C "$APP_DIR" diff --name-only "$BASE" "$NEW")
# 工作区已经是 NEW 时 reset 是空操作，但 diff 仍要按 BASE 计算
if [ "$BASE" != "$OLD" ]; then
  log "上次成功部署停在 ${BASE:0:7}，本轮按 ${BASE:0:7}..${NEW:0:7} 计算变更"
fi

# .env 在 .gitignore 里，reset 不会动它；uploads / private-esign 也不跟踪
run_as_owner git -C "$APP_DIR" reset --hard --quiet "$NEW"

server_changed=0
echo "$CHANGED" | grep -q '^server/' && server_changed=1 || true

if echo "$CHANGED" | grep -qE '^server/package(-lock)?\.json$'; then
  log "后端依赖有变化，执行 npm ci"
  run_as_owner npm --prefix "$APP_DIR/server" ci --omit=dev --no-audit --no-fund
  server_changed=1
fi

# 迁移是幂等的，每次都跑；它不改变 server_changed ——
# 只改管理后台的提交不应该顺带重启后端
log "执行数据库迁移"
run_as_owner npm --prefix "$APP_DIR/server" run migrate

# 管理后台：只在 admin/ 有改动或 dist 缺失时构建，避免每次部署都花几分钟
if echo "$CHANGED" | grep -q '^admin/' || [ ! -f "$APP_DIR/admin/dist/index.html" ]; then
  log "构建管理后台"
  if [ ! -d "$APP_DIR/admin/node_modules" ] || echo "$CHANGED" | grep -q '^admin/pnpm-lock\.yaml$'; then
    NODE_OPTIONS="$NODE_OPTIONS" pnpm --dir "$APP_DIR/admin" install --frozen-lockfile
  fi
  NODE_OPTIONS="$NODE_OPTIONS" pnpm --dir "$APP_DIR/admin" build
  # nginx 以 www 运行，只需读权限；不要 chown 成 root 之外的用户，
  # 否则下次以 root 构建时又会改回来，来回折腾
  chmod -R a+rX "$APP_DIR/admin/dist"
fi

if [ "$server_changed" -eq 1 ]; then
  if restart_and_probe; then
    mark_success "$NEW"
    log "部署完成：${NEW:0:7}"
    exit 0
  fi

  handle_failure "$NEW" "$DEPLOYED" "$OLD"
fi

mark_success "$NEW"
log "后端无变化，不重启。部署完成：${NEW:0:7}"
