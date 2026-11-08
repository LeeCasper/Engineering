<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import {
  fetchConfigs,
  fetchResetConfig,
  fetchUpdateConfig,
  type ConfigScope,
  type SysConfigItem
} from '@/service/api/config';
import { useAuthStore } from '@/store/modules/auth';
import { formatDateTime } from '@/utils/format';

defineOptions({ name: 'ConfigPage' });

const props = withDefaults(
  defineProps<{
    /** tenant=租户覆盖配置；platform=平台基础配置 */
    scope?: ConfigScope;
  }>(),
  { scope: 'tenant' }
);

const authStore = useAuthStore();
const isPlatformScope = computed(() => props.scope === 'platform');
// 平台基础配置由平台运营维护；租户配置由租户 owner 维护。
// 平台持排障授权进入租户时 isPlatform 为 true，但 scope 仍是 tenant，
// 这里必须保持只读，不能因为角色是 platform 就放开写。
const canEdit = computed(() =>
  isPlatformScope.value ? authStore.isPlatform : authStore.isTenantOwner
);
const isOwner = canEdit;

const loading = ref(false);
const saving = ref(false);
const list = ref<SysConfigItem[]>([]);
const drafts = reactive<Record<string, string>>({});
const activeTab = ref('');

const ENUM_LABELS: Record<string, Record<string, string>> = {
  gate_strength: {
    strict: '严格（未结清阻断汇报与验收）',
    standard: '标准（仅阻断验收，放行汇报）',
    loose: '宽松（仅提醒）'
  },
  operation_log_retention: {
    forever: '永久保留',
    '365d': '365 天',
    '180d': '180 天'
  }
};

interface GroupDef {
  key: string;
  title: string;
  description: string;
  keys?: string[];
  prefix?: string;
}

const GROUP_DEFS: GroupDef[] = [
  {
    key: 'brand',
    title: '小程序品牌',
    description:
      '小程序名称与 Logo 由平台统一维护；建议在「小程序品牌」页面设置，这里显示底层配置值。',
    keys: ['miniapp_name', 'miniapp_logo']
  },
  {
    key: 'remind',
    title: '提醒与门禁',
    description: '未汇报提醒、验收超时与大额支出的阈值；门禁强度决定未结清阶段能否继续汇报。',
    keys: ['stale_report_days', 'acceptance_timeout_hours', 'big_expense_ratio', 'gate_strength']
  },
  {
    key: 'report',
    title: '汇报附件',
    description: '单次进度汇报允许提交的照片、视频数量与视频时长上限。',
    keys: ['report_max_images', 'report_max_videos', 'report_max_video_seconds']
  },
  {
    key: 'subscribe',
    title: '订阅消息模板',
    description:
      '微信订阅消息模板 ID 与数据映射由平台统一配置（模板来自小程序主体），租户只读；模板 ID 留空表示该类消息只发站内信。',
    prefix: 'subscribe_template_'
  },
  {
    key: 'route',
    title: '签到与路线',
    description: '签到偏差阈值与路线途经点上限；修改后对新签到 / 新规划生效，历史记录保留当时的判定。',
    keys: ['sign_in_distance_threshold', 'route_max_points']
  },
  {
    key: 'misc',
    title: '日志与内容',
    description: '操作日志保留时长与 C 端未分配项目时展示的客服联系方式。',
    keys: ['operation_log_retention', 'support_contact']
  }
];

const groups = computed(() => {
  const buckets = GROUP_DEFS.map(def => ({
    key: def.key,
    title: def.title,
    description: def.description,
    items: [] as SysConfigItem[]
  }));
  const other = { key: 'other', title: '其他', description: '', items: [] as SysConfigItem[] };

  for (const item of list.value) {
    const index = GROUP_DEFS.findIndex(def =>
      def.keys ? def.keys.includes(item.key) : Boolean(def.prefix && item.key.startsWith(def.prefix))
    );

    (index >= 0 ? buckets[index] : other).items.push(item);
  }

  return [...buckets, other].filter(bucket => bucket.items.length);
});

function canEditItem(item: SysConfigItem) {
  // 平台专属项（订阅消息模板 ID）在租户后台只读：
  // 模板 ID 来自小程序主体，租户申请不到，配了也不会生效。
  return canEdit.value && (isPlatformScope.value || !item.platformOnly);
}

function changed(item: SysConfigItem) {
  return String(drafts[item.key] ?? '') !== String(item.value ?? '');
}

const dirtyItems = computed(() => list.value.filter(changed));

async function load() {
  loading.value = true;

  try {
    const { data, error } = await fetchConfigs(props.scope);

    if (!error && data) {
      list.value = data.list;

      for (const item of data.list) {
        drafts[item.key] = item.value;
      }

      if (!activeTab.value || !groups.value.some(group => group.key === activeTab.value)) {
        activeTab.value = groups.value[0]?.key || '';
      }
    }
  } finally {
    loading.value = false;
  }
}

async function saveAll() {
  if (!canEdit.value || !dirtyItems.value.length) return;

  saving.value = true;
  const failed: string[] = [];
  let saved = 0;

  try {
    // 逐项提交：后端接口是「按 key 更新」，不做批量事务。
    // 一项失败不影响其他项，最后如实报告失败项 —— 不静默跳过。
    for (const item of [...dirtyItems.value]) {
      const value = String(drafts[item.key] ?? '');
      const { data, error } = await fetchUpdateConfig(item.key, value, props.scope);

      if (error || !data) {
        failed.push(item.label);
        continue;
      }

      item.value = data.value;
      drafts[item.key] = data.value;
      item.source = data.source;
      item.isDefault = data.source === 'default';
      item.inherited = props.scope === 'tenant' && data.source !== 'tenant';
      saved += 1;
    }
  } finally {
    saving.value = false;
  }

  if (failed.length) {
    ElMessage.warning(`已保存 ${saved} 项，失败 ${failed.length} 项：${failed.join('、')}`);
  } else {
    ElMessage.success(`已保存 ${saved} 项配置`);
  }
}

async function resetItem(item: SysConfigItem) {
  if (isPlatformScope.value || !canEdit.value) return;

  const { data, error } = await fetchResetConfig(item.key);

  if (error || !data) return;

  ElMessage.success(`${item.label}已恢复平台默认`);
  await load();
}

function discardAll() {
  for (const item of list.value) {
    drafts[item.key] = item.value;
  }
}

onMounted(load);
</script>

<template>
  <div class="p-16px">
    <ElCard v-loading="loading" class="mx-auto max-w-1400px" shadow="never">
      <template #header>
        <div class="flex flex-wrap items-center justify-between gap-12px">
          <div>
            <div class="text-16px font-600 text-#1d2129">
              {{ isPlatformScope ? '平台基础配置' : '系统配置' }}
            </div>
            <div class="pt-2px text-12px text-#86909c">
              {{
                isPlatformScope
                  ? '租户未覆盖时继承这里的值；修改只影响新产生的数据，不回溯历史记录'
                  : '配置变更只对 新产生 的数据生效，不回溯改写历史记录的判定结果'
              }}
            </div>
          </div>

          <div class="flex items-center gap-8px">
            <ElTag v-if="!canEdit" type="info">只读</ElTag>
            <template v-else>
              <ElTag v-if="dirtyItems.length" type="warning">{{ dirtyItems.length }} 项未保存</ElTag>
              <ElButton v-if="dirtyItems.length" :disabled="saving" @click="discardAll">放弃修改</ElButton>
              <ElButton
                type="primary"
                :disabled="!dirtyItems.length"
                :loading="saving"
                @click="saveAll"
              >
                保存修改
              </ElButton>
            </template>
          </div>
        </div>
      </template>

      <ElAlert
        v-if="isPlatformScope"
        class="mb-14px"
        type="info"
        :closable="false"
        show-icon
        title="这是所有租户共享的平台基础配置"
        description="租户没有覆盖的配置项会继承这里的值。租户管理员可以在自己的系统配置页覆盖，或恢复平台默认。"
      />

      <ElAlert
        v-else-if="!canEdit"
        class="mb-14px"
        type="info"
        :closable="false"
        show-icon
        :title="
          authStore.isPlatform
            ? '平台账号在排障窗口内只能查看配置'
            : '项目管理员可以查看配置，但不能修改'
        "
        :description="
          authStore.isPlatform
            ? '平台对租户数据只有只读窗口，任何保存都会被拒绝。'
            : '修改系统配置需要租户管理员权限（AC-AD67）。'
        "
      />

      <ElTabs v-model="activeTab" class="config-tabs">
        <ElTabPane v-for="group in groups" :key="group.key" :label="group.title" :name="group.key">
          <div class="pb-2px">
            <div class="mb-12px flex flex-wrap items-center gap-8px text-13px leading-20px text-#4e5969">
              <span>{{ group.description }}</span>
              <span class="text-12px text-#86909c">共 {{ group.items.length }} 项</span>
            </div>

            <div class="settings-grid">
              <div v-for="item in group.items" :key="item.key" class="setting-item">
                <div class="flex flex-wrap items-center gap-6px">
                  <span class="setting-label">{{ item.label }}</span>
                  <template v-if="!isPlatformScope && item.platformOnly">
                    <ElTag size="small" type="info">平台统一配置</ElTag>
                  </template>
                  <template v-else>
                    <ElTag v-if="item.source === 'default'" size="small" type="info">出厂值</ElTag>
                    <ElTag v-else-if="item.source === 'platform'" size="small" type="success">
                      {{ isPlatformScope ? '平台已配置' : '继承平台' }}
                    </ElTag>
                    <ElTag v-else size="small" type="warning">租户覆盖</ElTag>
                  </template>
                  <ElTag v-if="!item.effective" size="small" type="warning">暂未生效</ElTag>
                  <ElTag class="ml-auto" size="small" type="info">{{ item.requirement }}</ElTag>
                </div>

                <div class="mt-12px">
                  <ElSelect
                    v-if="item.type === 'enum'"
                    v-model="drafts[item.key]"
                    class="w-full"
                    :disabled="!canEditItem(item)"
                  >
                    <ElOption
                      v-for="value in item.allowed || []"
                      :key="value"
                      :label="ENUM_LABELS[item.key]?.[value] || value"
                      :value="value"
                    />
                  </ElSelect>

                  <ElInput
                    v-else
                    v-model="drafts[item.key]"
                    :disabled="!canEditItem(item)"
                    :maxlength="item.maxLength || undefined"
                    :type="item.type === 'int' || item.type === 'ratio' ? 'number' : 'text'"
                    :class="item.type === 'string' ? '' : 'w-220px'"
                  >
                    <template v-if="item.unit && item.type !== 'ratio'" #append>
                      {{ item.unit }}
                    </template>
                  </ElInput>
                </div>

                <div class="setting-meta">
                  <span class="font-mono text-11px">{{ item.key }}</span>
                  <span v-if="!isPlatformScope && item.platformOnly" class="text-#e6a23c">
                    由平台运营在微信公众平台申请后统一配置，租户只读
                  </span>
                  <span v-if="item.type === 'ratio'">0.10 = 10%</span>
                  <span v-else-if="item.type === 'int' && item.min != null">
                    范围 {{ item.min }}–{{ item.max }}{{ item.unit || '' }}
                  </span>
                  <span v-else-if="item.maxLength">最多 {{ item.maxLength }} 字符</span>
                  <span v-if="item.note">{{ item.note }}</span>
                  <span v-if="!item.effective" class="text-#e6a23c">
                    修改不会立即生效：对应功能尚未交付
                  </span>
                </div>

                <div
                  v-if="!isPlatformScope && item.inherited"
                  class="mt-6px flex flex-wrap items-center gap-8px text-11px text-#86909c"
                >
                  <span>
                    当前生效值来自{{
                      item.source === 'platform' ? '平台基础配置' : '出厂默认值'
                    }}：{{ item.platformValue ?? item.value }}
                  </span>
                </div>

                <div
                  v-else-if="!isPlatformScope && item.source === 'tenant' && canEditItem(item)"
                  class="mt-6px"
                >
                  <ElButton link type="primary" size="small" @click="resetItem(item)">
                    恢复平台默认
                  </ElButton>
                </div>

                <div v-if="item.updatedAt" class="mt-6px text-11px text-#c0c4cc">
                  更新于 {{ formatDateTime(item.updatedAt) }}
                </div>
              </div>
            </div>
          </div>
        </ElTabPane>
      </ElTabs>

      <ElEmpty v-if="!loading && !list.length" description="没有可配置项" />
    </ElCard>
  </div>
</template>

<style scoped>
.config-tabs :deep(.el-tabs__header) {
  margin-bottom: 16px;
}

.settings-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.setting-item {
  display: flex;
  flex-direction: column;
  padding: 16px;
  background: #fff;
  border: 1px solid #e5e6eb;
  border-radius: 8px;
  transition: border-color 0.16s ease, box-shadow 0.16s ease;
}

.setting-item:hover {
  border-color: #c9cdd4;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.03);
}

.setting-label {
  font-size: 14px;
  font-weight: 500;
  color: #1d2129;
}

.setting-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  margin-top: 8px;
  font-size: 12px;
  line-height: 18px;
  color: #86909c;
}

@media (max-width: 900px) {
  .settings-grid {
    grid-template-columns: 1fr;
  }
}
</style>
