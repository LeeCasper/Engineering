#!/usr/bin/env bash
#
# 部署脚本纯决策逻辑的单元测试。
#
# 只测「该不该部署 / 该不该跳过 / 回滚到哪 / 告警内容怎么转义」这几件纯字符串判断，
# 不碰 git、systemd、npm —— 那些需要真实环境，属于服务器上的联调范围。
#
# 用法：bash deploy/test-deploy-lib.sh

set -u

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)

# 以 lib 模式 source：脚本会在函数定义之后、加锁与 cd 之前返回
DEPLOY_LIB_ONLY=1
# shellcheck disable=SC1091
. "$SCRIPT_DIR/renovation-deploy.sh"

passed=0
failed=0

ok() { passed=$((passed + 1)); printf '  ✓ %s\n' "$1"; }
no() { failed=$((failed + 1)); printf '  ✗ %s\n' "$1"; }

check_true() { # DESC COMMAND...
  local desc=$1
  shift
  if "$@"; then ok "$desc"; else no "$desc"; fi
}

check_false() { # DESC COMMAND...
  local desc=$1
  shift
  if "$@"; then no "$desc"; else ok "$desc"; fi
}

check_eq() { # DESC EXPECTED ACTUAL
  local desc=$1 expected=$2 actual=$3
  if [ "$expected" = "$actual" ]; then
    ok "$desc"
  else
    no "$desc（期望 '$expected'，实际 '$actual'）"
  fi
}

echo 'should_deploy：什么时候需要部署'

check_true '提交变了 → 部署' should_deploy aaa bbb bbb
check_true '标记落后于工作区（上次部署中途失败）→ 部署' should_deploy bbb bbb aaa
check_false '工作区与标记都等于目标 → 不部署' should_deploy bbb bbb bbb
check_true '首次部署（没有标记）→ 部署' should_deploy aaa bbb ''

echo
echo 'is_quarantined：什么时候跳过失败提交'

check_true '上次失败并回滚过的同一个提交 → 隔离' is_quarantined bbb bbb 0
check_false 'DEPLOY_FORCE=1 → 强制重试' is_quarantined bbb bbb 1
check_false '新的提交 → 不隔离' is_quarantined aaa bbb 0
check_false '没有隔离记录 → 不隔离' is_quarantined '' bbb 0

echo
echo 'choose_rollback_target：回滚到哪'

check_eq '优先回滚到上次成功部署的提交' aaa "$(choose_rollback_target aaa bbb ccc)"
check_eq '没有成功标记时回滚到部署前的工作区' bbb "$(choose_rollback_target '' bbb ccc)"
check_eq '两者都不可用时不回滚' '' "$(choose_rollback_target '' '' ccc)"
check_eq '绝不回滚到失败提交本身' aaa "$(choose_rollback_target ccc aaa ccc)"

echo
echo 'json_escape：企业微信告警内容'

check_eq '双引号转义' 'a\"b' "$(json_escape 'a"b')"
check_eq '反斜杠转义' 'a\\b' "$(json_escape 'a\b')"
check_eq '换行压平成空格' 'a b' "$(json_escape "$(printf 'a\nb')")"

echo
printf '通过 %d，失败 %d\n' "$passed" "$failed"
[ "$failed" -eq 0 ]
