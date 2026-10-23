<script setup lang="ts">
import { REGION_CASCADER_OPTIONS } from '@/utils/region';

defineOptions({ name: 'RegionCascader' });

const model = defineModel<string[]>({ default: () => [] });

const props = withDefaults(
  defineProps<{
    disabled?: boolean;
    clearable?: boolean;
    placeholder?: string;
  }>(),
  {
    disabled: false,
    clearable: false,
    placeholder: '请选择省 / 市'
  }
);
</script>

<template>
  <ElCascader
    v-model="model"
    class="w-full"
    :options="REGION_CASCADER_OPTIONS"
    :disabled="props.disabled"
    :clearable="props.clearable"
    :placeholder="props.placeholder"
    :props="{
      value: 'value',
      label: 'label',
      children: 'children',
      emitPath: true,
      checkStrictly: false
    }"
    filterable
    separator=" / "
  />
</template>
