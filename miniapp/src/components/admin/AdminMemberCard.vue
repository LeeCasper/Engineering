<template>
  <view class="member-card" @tap="$emit('select', member)">
    <view class="member-avatar">{{ initial }}</view>

    <view class="member-main">
      <view class="member-name-row">
        <text class="member-name">{{ displayName }}</text>
        <text class="member-role">{{ roleText }}</text>
      </view>
      <text class="member-phone">{{ member.phoneMasked || '未绑定手机号' }}</text>
      <view v-if="showProject" class="member-project">
        <text class="member-project-name">{{ member.projectName || '未归属项目' }}</text>
        <text v-if="member.projectStatus === 'archived'" class="member-project-archived">已归档</text>
      </view>
    </view>

    <text class="member-status" :class="statusTone">{{ statusText }}</text>
  </view>
</template>

<script setup>
import { computed } from 'vue'
import { memberRoleText, memberStatusText } from '../../utils/admin'

defineOptions({ name: 'AdminMemberCard' })

const props = defineProps({
  member: { type: Object, required: true },
  showProject: { type: Boolean, default: true },
})

defineEmits(['select'])

const displayName = computed(
  () => props.member.nickname || props.member.phoneMasked || '待确认用户'
)

const initial = computed(() => {
  const name = displayName.value
  return name ? name.slice(0, 1) : '成'
})

const roleText = computed(() => memberRoleText(props.member))
const statusText = computed(() => memberStatusText(props.member))

const statusTone = computed(() => {
  const status = props.member.status
  if (status === 'active') return 'member-status--green'
  if (status === 'pending') return 'member-status--orange'
  return 'member-status--gray'
})
</script>

<style scoped lang="scss">
.member-card {
  display: flex;
  align-items: center;
  padding: dp(16);
  @include glass-surface(dp(18), 18px);
}

.member-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(44);
  height: dp(44);
  margin-right: dp(14);
  border-radius: 50%;
  background: #fce5d6;
  color: #d85e22;
  font-size: dp(17);
  font-weight: 700;
  flex-shrink: 0;
}

.member-main {
  flex: 1;
  min-width: 0;
}

.member-name-row {
  display: flex;
  align-items: center;
  gap: dp(8);
}

.member-name {
  overflow: hidden;
  color: #1d2129;
  font-size: dp(15);
  font-weight: 700;
  line-height: 1.3;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.member-role {
  padding: dp(2) dp(8);
  border-radius: dp(999);
  background: #fff0e6;
  color: #eb5c20;
  font-size: dp(10);
  font-weight: 600;
  line-height: 1.3;
  white-space: nowrap;
  flex-shrink: 0;
}

.member-phone {
  display: block;
  margin-top: dp(5);
  color: #86909c;
  font-size: dp(12);
  line-height: 1.2;
}

.member-project {
  display: flex;
  align-items: center;
  margin-top: dp(3);
}

.member-project-name {
  overflow: hidden;
  color: #86909c;
  font-size: dp(11);
  line-height: 1.3;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.member-project-archived {
  margin-left: dp(5);
  padding: dp(1) dp(5);
  border-radius: dp(4);
  background: #f2f3f5;
  color: #86909c;
  font-size: dp(9);
  line-height: 1.2;
  flex-shrink: 0;
}

.member-status {
  margin-left: dp(10);
  padding: dp(4) dp(12);
  border-radius: dp(999);
  font-size: dp(11);
  font-weight: 600;
  line-height: 1.3;
  white-space: nowrap;
  flex-shrink: 0;
}

.member-status--green {
  background: #e8f8f0;
  color: #149a5d;
}

.member-status--orange {
  background: #fff1e8;
  color: #eb5c20;
}

.member-status--gray {
  background: #f2f3f5;
  color: #86909c;
}
</style>
