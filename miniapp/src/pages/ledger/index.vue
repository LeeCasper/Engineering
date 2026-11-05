<template>
  <view class="page">
    <!-- 自定义导航：设计稿的手机壳状态栏与微信胶囊不在真机重复绘制 -->
    <view class="nav" :style="{ paddingTop: `${safeTop + 6}px` }">
      <view class="nav-main">
        <view class="project-trigger" @tap="openProjectSheet">
          <text class="project-name">{{ headerTitle }}</text>
          <image class="project-caret" src="/static/images/icon-caret-down-gray.png" mode="aspectFit" />
        </view>
        <view v-if="detail" class="role-pill" @tap="showRoleHint">我是{{ detail.myRoleLabel }}</view>
      </view>
    </view>

    <!-- 首次加载 -->
    <view v-if="loading && !detail" class="gc-loading-page">
      <gc-skeleton :rows="3" />
    </view>

    <!-- 没有项目上下文：记账以项目为单位，不默认第一个项目 -->
    <view v-else-if="!current" class="state-block">
      <image class="state-icon" src="/static/images/icon-acceptance-empty.png" mode="aspectFit" />
      <text class="state-title">选择记账项目</text>
      <text class="state-text">记账以项目为单位。仅展示你是业主或工长的项目。</text>

      <view v-if="projectSheetLoading" class="project-picker">
        <view class="sheet-state"><gc-loading inline text="加载中" /></view>
      </view>
      <view v-else-if="projectLoadError" class="project-picker">
        <view class="sheet-state">{{ projectLoadError }}</view>
      </view>
      <view v-else-if="projectOptions.length" class="project-picker">
        <view
          v-for="project in projectOptions"
          :key="project.id"
          class="project-picker-row"
          @tap="selectProject(project)"
        >
          <view class="project-picker-main">
            <text class="project-picker-name">{{ project.name }}</text>
            <text class="project-picker-meta">
              {{ project.address || '未填写地址' }} · 我是{{ project.myRoleLabel }}
            </text>
          </view>
          <image class="project-picker-chevron" src="/static/images/icon-chevron-right.png" mode="aspectFit" />
        </view>
      </view>
      <view v-else class="project-picker">
        <view class="sheet-state">暂无可查看账目的项目</view>
      </view>

      <button class="state-btn" @tap="loadProjects">刷新项目</button>
      <button class="state-btn state-btn--ghost" @tap="goProjects">返回项目列表</button>
    </view>

    <!-- 加载失败 / 项目不可用 -->
    <view v-else-if="loadError" class="state-block">
      <image class="state-icon" src="/static/images/icon-acceptance-empty.png" mode="aspectFit" />
      <text class="state-title">项目账目不可用</text>
      <text class="state-text">{{ loadError }}</text>
      <button class="state-btn" @tap="reload">重新加载</button>
      <button class="state-btn state-btn--ghost" @tap="openProjectSheet">切换项目</button>
    </view>

    <!-- 监理不参与记账（AC-L27） -->
    <view v-else-if="detail && !hasLedgerAccess" class="state-block">
      <view class="restricted-icon">
        <image class="restricted-icon-img" src="/static/images/icon-shield-accent.png" mode="aspectFit" />
      </view>
      <text class="state-title">监理不参与记账</text>
      <text class="state-text">项目账目仅对业主和工长开放。监理可以在验收模块查看与工程质量相关的记录。</text>
      <button class="state-btn" @tap="openProjectSheet">切换项目</button>
      <button class="state-btn state-btn--ghost" @tap="goProjects">返回项目列表</button>
    </view>

    <view v-else-if="detail" class="content gc-stagger">
      <!-- 合同与总览 -->
      <view v-if="summary" class="hero">
        <image class="hero-mark" src="/static/images/ledger-hero-mark.png" mode="aspectFit" />
        <view class="hero-top">
          <view class="hero-label" @tap="showContractAmountInfo">
            <text>合同总额</text>
            <text class="hero-info">i</text>
          </view>
          <view class="contract-link" @tap="contractSheetOpen = true">
            <text>查看合同</text>
            <image class="contract-link-icon" src="/static/images/icon-chevron-right-white.png" mode="aspectFit" />
          </view>
        </view>

        <view class="hero-amount">
          <text class="hero-yen">¥</text>
          <text>{{ formatMoney(summary.contractAmount) }}</text>
        </view>

        <view class="hero-breakdown">
          <view class="hero-cell">
            <text class="hero-cell-label">{{ heroLabels.paid }}</text>
            <text class="hero-cell-value hero-cell-value--green">¥{{ formatMoney(summary.totalIncome) }}</text>
          </view>
          <view class="hero-cell hero-cell--info" @tap="showBalanceInfo">
            <view class="hero-cell-label-row">
              <text class="hero-cell-label">工程结余</text>
              <text class="hero-info hero-info--gray">i</text>
            </view>
            <text class="hero-cell-value" :class="{ 'hero-cell-value--danger': summary.isBalanceNegative }">
              ¥{{ formatMoney(summary.balance) }}
            </text>
          </view>
          <view class="hero-cell">
            <text class="hero-cell-label">{{ pendingLabel }}</text>
            <text class="hero-cell-value hero-cell-value--orange">¥{{ formatMoney(summary.pendingAmount) }}</text>
          </view>
          <view class="hero-cell">
            <text class="hero-cell-label">施工支出</text>
            <text class="hero-cell-value hero-cell-value--orange">¥{{ formatMoney(summary.totalExpense) }}</text>
          </view>
        </view>
      </view>

      <text v-if="summary" class="scope-note">合同与收支汇总为全量口径，不随流水筛选变化</text>

      <!-- 待我处理 -->
      <view v-if="pendingItems.length" class="pending-card">
        <view class="pending-head">
          <view class="pending-title">
            <image class="pending-warning" src="/static/images/icon-warning-amber.png" mode="aspectFit" />
            <text>待我处理</text>
          </view>
          <view class="pending-count" @tap="pendingSheetOpen = true">
            共 {{ pendingItems.length }} 项待处理
            <image class="pending-count-chevron" src="/static/images/icon-chevron-right.png" mode="aspectFit" />
          </view>
        </view>

        <view class="pending-list">
          <view
            v-for="item in pendingPreview"
            :key="item.key"
            class="pending-item"
            @tap="onPendingTap(item)"
          >
            <view class="pending-icon">
              <image class="pending-icon-img" src="/static/images/icon-document-amber.png" mode="aspectFit" />
            </view>
            <text class="pending-name">{{ item.name }}</text>
            <template v-if="item.type === 'payment'">
              <text class="pending-amount">¥{{ formatMoney(item.amount) }}</text>
              <text class="pending-badge">待确认</text>
            </template>
            <image class="pending-chevron" src="/static/images/icon-chevron-right.png" mode="aspectFit" />
          </view>
        </view>
      </view>

      <!-- 概览 / 流水 / 对账 -->
      <view class="segment">
        <view class="segment-thumb" :style="thumbStyle" />
        <view
          v-for="tab in TABS"
          :key="tab.key"
          class="segment-item"
          :class="{ 'segment-item--active': visualTabKey === tab.key }"
          @tap="switchTab(tab.key)"
        >
          {{ tab.label }}
        </view>
      </view>

      <!-- 概览 -->
      <template v-if="activeTab === 'overview'">
        <view class="card">
          <view class="section-head">
            <view class="section-title-wrap">
              <image class="section-icon" src="/static/images/icon-list-accent.png" mode="aspectFit" />
              <text class="section-title">付款节点</text>
            </view>
            <view class="section-link" @tap="openNodesSheet">
              <text>查看全部节点</text>
              <image class="section-chevron" src="/static/images/icon-chevron-right.png" mode="aspectFit" />
            </view>
          </view>

          <view v-if="nodes.length" class="milestones">
            <view
              v-for="(node, index) in overviewNodes"
              :key="node.id"
              class="milestone"
              :class="[
                `milestone--${nodeTone(node)}`,
                { 'milestone--last': index === overviewNodes.length - 1 },
              ]"
              @tap="openNodesSheet"
            >
              <view class="milestone-dot" :class="`milestone-dot--${nodeTone(node)}`">
                <image
                  v-if="node.status === 'confirmed'"
                  class="milestone-check"
                  src="/static/images/icon-check-white.png"
                  mode="aspectFit"
                />
                <view
                  v-else-if="node.status === 'paid' || node.status === 'unlocked'"
                  class="milestone-core"
                  :class="`milestone-core--${nodeTone(node)}`"
                />
              </view>

              <text class="milestone-name" :class="{ 'milestone-name--active': node.status === 'paid' }">
                {{ node.name }}
              </text>

              <view class="milestone-actions">
                <text class="milestone-badge" :class="`milestone-badge--${nodeTone(node)}`">
                  {{ nodeBadge(node) }}
                </text>
                <view
                  v-if="isPrimaryOwner && node.status === 'paid'"
                  class="confirm-btn"
                  @tap.stop="confirmNode(node)"
                >
                  确认已支付
                </view>
                <image class="milestone-chevron" src="/static/images/icon-chevron-right.png" mode="aspectFit" />
              </view>
            </view>
          </view>
          <view v-else class="card-empty">暂无付款节点，等待装修公司设置。</view>
        </view>

        <view class="card">
          <view class="section-head">
            <view class="section-title-wrap">
              <image class="section-icon" src="/static/images/icon-chart-accent.png" mode="aspectFit" />
              <text class="section-title">本阶段账目</text>
            </view>
            <text v-if="currentStageRow" class="section-pill">{{ currentStageRow.stageName }}</text>
          </view>

          <view v-if="currentStageRow" class="stage-metrics">
            <view class="stage-tile">
              <view class="stage-metric">
                <view class="stage-metric-icon">
                  <image class="stage-metric-img" src="/static/images/icon-stage-due.png" mode="aspectFit" />
                </view>
                <view class="stage-metric-text">
                  <text class="stage-metric-label">应收</text>
                  <text class="stage-metric-value">¥{{ formatMoney(currentStageRow.dueAmount) }}</text>
                </view>
              </view>
              <view class="stage-divider" />
              <view class="stage-metric">
                <view class="stage-metric-icon">
                  <image class="stage-metric-img" src="/static/images/icon-stage-paid.png" mode="aspectFit" />
                </view>
                <view class="stage-metric-text">
                  <text class="stage-metric-label">{{ heroLabels.stagePaid }}</text>
                  <text class="stage-metric-value">¥{{ formatMoney(currentStageRow.incomeAmount) }}</text>
                </view>
              </view>
            </view>

            <view class="stage-tile">
              <view class="stage-metric">
                <view class="stage-metric-icon">
                  <image class="stage-metric-img" src="/static/images/icon-stage-expense.png" mode="aspectFit" />
                </view>
                <view class="stage-metric-text">
                  <text class="stage-metric-label">支出</text>
                  <text class="stage-metric-value">¥{{ formatMoney(currentStageRow.expenseAmount) }}</text>
                </view>
              </view>
              <view class="stage-divider" />
              <view class="stage-metric">
                <view class="stage-metric-icon">
                  <image class="stage-metric-img" src="/static/images/icon-stage-balance.png" mode="aspectFit" />
                </view>
                <view class="stage-metric-text">
                  <text class="stage-metric-label">结余</text>
                  <text class="stage-metric-value">¥{{ formatMoney(currentStageRow.balance) }}</text>
                </view>
              </view>
            </view>
          </view>
          <view v-else class="card-empty">当前阶段暂无账目。</view>
        </view>

        <view class="card">
          <view class="section-head">
            <view class="section-title-wrap">
              <image class="section-icon" src="/static/images/icon-pie-accent.png" mode="aspectFit" />
              <text class="section-title">支出构成</text>
            </view>
          </view>

          <view v-if="expenseRows.length" class="expense-list">
            <view v-for="row in expenseRows" :key="row.category" class="expense-row">
              <text class="expense-label">{{ row.shortLabel }}</text>
              <view class="expense-track">
                <view class="expense-fill" :style="{ width: `${row.percent}%` }" />
              </view>
              <text class="expense-percent">{{ row.percent }}%</text>
            </view>
          </view>
          <view v-else class="card-empty">暂无支出记录。</view>
        </view>
      </template>

      <!-- 流水 -->
      <view v-else-if="activeTab === 'flow'" class="tab-panel">
        <view v-if="isForeman" class="tab-action-row">
          <button class="tab-action-btn" @tap="openEntrySheet">＋ 登记流水</button>
        </view>

        <view class="filter-row">
          <view
            v-for="filter in FLOW_FILTERS"
            :key="filter.key"
            class="filter-chip"
            :class="{ 'filter-chip--active': flowFilter === filter.key }"
            @tap="changeFlowFilter(filter.key)"
          >
            {{ filter.label }}
          </view>
        </view>

        <view v-if="entriesLoading && !entries.length" class="card empty-card">
          <gc-loading text="正在加载流水…" />
        </view>
        <view v-else-if="!entries.length" class="card empty-card">
          <image class="empty-icon" src="/static/images/icon-receipt-gray.png" mode="aspectFit" />
          <text class="empty-title">暂无流水</text>
          <text class="empty-text">工长登记收支后，这里会显示全部账目。汇总为全量口径，不随筛选变化。</text>
        </view>

        <view v-else class="flow-list">
          <view v-for="entry in entries" :key="entry.id" class="flow-card">
            <view class="flow-top">
              <view class="flow-type" :class="`flow-type--${entry.type}`">
                {{ entry.typeLabel }}
              </view>
              <text v-if="entry.isReversal" class="flow-reversal">红冲</text>
              <text class="flow-date">{{ formatDate(entry.occurredAt) }}</text>
              <text class="flow-amount" :class="flowAmountClass(entry)">{{ flowAmount(entry) }}</text>
            </view>

            <view class="flow-meta">
              <text v-if="entry.stageName">{{ entry.stageName }}</text>
              <text v-if="entry.categoryLabel" class="flow-meta-item"> · {{ entry.categoryLabel }}</text>
              <text v-if="entry.paymentNodeName" class="flow-meta-item"> · {{ entry.paymentNodeName }}</text>
            </view>

            <text v-if="entry.remark" class="flow-remark">{{ entry.remark }}</text>

            <view v-if="entry.receiptImages && entry.receiptImages.length" class="flow-receipts">
              <image
                v-for="(image, imageIndex) in entry.receiptImages"
                :key="`${entry.id}-${imageIndex}`"
                class="flow-receipt"
                :src="resolveMediaUrl(image.url)"
                mode="aspectFill"
                @tap.stop="previewReceipt(entry, imageIndex)"
              />
            </view>

            <view v-if="entry.locked || entry.isReversal" class="flow-flags">
              <template v-if="entry.locked">
                <image class="flow-lock" src="/static/images/icon-lock-gray.png" mode="aspectFit" />
                <text>已对账锁定</text>
              </template>
              <text v-if="entry.isReversal" class="flow-flag-reversal">红冲记录，原记录保留</text>
            </view>
          </view>

          <view v-if="entries.length < entriesTotal" class="load-more" @tap="loadEntries(false)">
            <gc-loading v-if="entriesLoading" inline text="加载中" />
            <text v-else>加载更多</text>
          </view>
        </view>
      </view>

      <!-- 对账 -->
      <view v-else class="tab-panel">
        <view v-if="isForeman" class="tab-action-row">
          <button class="tab-action-btn" @tap="openInitiateSheet">＋ 发起对账</button>
        </view>

        <view v-if="!reconciliations.length" class="card empty-card">
          <image class="empty-icon" src="/static/images/icon-document.png" mode="aspectFit" />
          <text class="empty-title">暂无对账单</text>
          <text class="empty-text">工长发起周期对账后，这里会显示对账周期、金额与确认状态。</text>
        </view>

        <view v-else class="rec-list">
          <view
            v-for="rec in reconciliations"
            :key="rec.id"
            class="rec-card"
            @tap="openReconciliation(rec)"
          >
            <view class="rec-top">
              <text class="rec-period">{{ recPeriodLabel(rec) }}</text>
              <text class="rec-status" :class="`rec-status--${rec.status}`">{{ rec.statusLabel }}</text>
              <image class="rec-chevron" src="/static/images/icon-chevron-right.png" mode="aspectFit" />
            </view>

            <view class="rec-amounts">
              <view class="rec-amount-item">
                <text class="rec-amount-label">收入</text>
                <text class="rec-amount-value rec-amount-value--green">¥{{ formatMoney(rec.incomeAmount) }}</text>
              </view>
              <view class="rec-amount-item">
                <text class="rec-amount-label">支出</text>
                <text class="rec-amount-value rec-amount-value--orange">¥{{ formatMoney(rec.expenseAmount) }}</text>
              </view>
            </view>

            <view class="rec-foot">
              <text>{{ rec.submittedByName || '工长' }} 提交于 {{ formatDateTime(rec.submittedAt) }}</text>
              <text v-if="rec.disputeCount > 0" class="rec-dispute">有 {{ rec.disputeCount }} 条异议</text>
            </view>
          </view>
        </view>
      </view>
    </view>

    <!-- 项目切换 -->
    <view v-if="projectSheetOpen" class="sheet-mask" @touchmove.stop.prevent="sheetSwipe.onMaskTouchMove" @tap="projectSheetOpen = false">
      <view class="sheet" :style="sheetSwipeStyle" @tap.stop>
        <view class="sheet-handle" @touchstart="sheetSwipe.onTouchStart" @touchmove.stop.prevent="sheetSwipe.onTouchMove" @touchend="sheetSwipe.onTouchEnd" />
        <view class="sheet-head" @touchstart="sheetSwipe.onTouchStart" @touchmove.stop.prevent="sheetSwipe.onTouchMove" @touchend="sheetSwipe.onTouchEnd">
          <view>
            <text class="sheet-title">切换项目</text>
            <text class="sheet-sub">仅展示你是业主或工长的项目</text>
          </view>
          <view class="sheet-close" @tap="projectSheetOpen = false">
            <image class="sheet-close-icon" src="/static/images/icon-close.png" mode="aspectFit" />
          </view>
        </view>

        <view v-if="projectSheetLoading" class="sheet-state"><gc-loading inline text="加载中" /></view>
        <view v-else-if="projectLoadError" class="sheet-state">{{ projectLoadError }}</view>
        <view v-else-if="!projectOptions.length" class="sheet-state">暂无可查看账目的项目</view>
        <view v-else class="project-options">
          <view
            v-for="project in projectOptions"
            :key="project.id"
            class="project-option"
            :class="{ 'project-option--active': isCurrentProject(project) }"
            @tap="selectProject(project)"
          >
            <view class="project-option-main">
              <text class="project-option-name">{{ project.name }}</text>
              <text class="project-option-meta">
                {{ project.address || '未填写地址' }} · 我是{{ project.myRoleLabel }}
              </text>
            </view>
            <text v-if="isCurrentProject(project)" class="project-option-current">当前</text>
            <image v-else class="project-option-chevron" src="/static/images/icon-chevron-right.png" mode="aspectFit" />
          </view>
        </view>
      </view>
    </view>

    <!-- 合同信息 -->
    <view v-if="contractSheetOpen" class="sheet-mask" @touchmove.stop.prevent="sheetSwipe.onMaskTouchMove" @tap="contractSheetOpen = false">
      <view class="sheet" :style="sheetSwipeStyle" @tap.stop>
        <view class="sheet-handle" @touchstart="sheetSwipe.onTouchStart" @touchmove.stop.prevent="sheetSwipe.onTouchMove" @touchend="sheetSwipe.onTouchEnd" />
        <view class="sheet-head" @touchstart="sheetSwipe.onTouchStart" @touchmove.stop.prevent="sheetSwipe.onTouchMove" @touchend="sheetSwipe.onTouchEnd">
          <view>
            <text class="sheet-title">合同信息</text>
            <text class="sheet-sub">系统只记录合同金额与工期，用于对账和付款节点</text>
          </view>
          <view class="sheet-close" @tap="contractSheetOpen = false">
            <image class="sheet-close-icon" src="/static/images/icon-close.png" mode="aspectFit" />
          </view>
        </view>

        <view class="detail-rows">
          <view class="detail-row">
            <text class="detail-label">项目名称</text>
            <text class="detail-value">{{ detail.name }}</text>
          </view>
          <view class="detail-row">
            <text class="detail-label">合同总额</text>
            <text class="detail-value detail-value--strong">¥{{ formatMoney(summary && summary.contractAmount) }}</text>
          </view>
          <view class="detail-row">
            <text class="detail-label">开工日期</text>
            <text class="detail-value">{{ formatDate(detail.startDate) || '未设置' }}</text>
          </view>
          <view class="detail-row">
            <text class="detail-label">计划完工</text>
            <text class="detail-value">{{ formatDate(detail.planEndDate) || '未设置' }}</text>
          </view>
          <view class="detail-row">
            <text class="detail-label">项目地址</text>
            <text class="detail-value">{{ detail.address || '未填写' }}</text>
          </view>
          <view class="detail-row">
            <text class="detail-label">项目状态</text>
            <text class="detail-value">{{ detail.statusLabel }}</text>
          </view>
        </view>

        <view class="sheet-note">
          合同文本由装修公司线下签署。系统不保存合同附件，只记录金额与工期，避免把线下合同误当成系统内的电子合同。
        </view>
        <button class="sheet-primary" @tap="contractSheetOpen = false">知道了</button>
      </view>
    </view>

    <!-- 全部付款节点 -->
    <view v-if="nodesSheetOpen" class="sheet-mask" @touchmove.stop.prevent="sheetSwipe.onMaskTouchMove" @tap="nodesSheetOpen = false">
      <view class="sheet" :style="sheetSwipeStyle" @tap.stop>
        <view class="sheet-handle" @touchstart="sheetSwipe.onTouchStart" @touchmove.stop.prevent="sheetSwipe.onTouchMove" @touchend="sheetSwipe.onTouchEnd" />
        <view class="sheet-head" @touchstart="sheetSwipe.onTouchStart" @touchmove.stop.prevent="sheetSwipe.onTouchMove" @touchend="sheetSwipe.onTouchEnd">
          <view>
            <text class="sheet-title">付款节点</text>
            <text class="sheet-sub">共 {{ nodes.length }} 个节点 · 款项全部走线下转账</text>
          </view>
          <view class="sheet-close" @tap="nodesSheetOpen = false">
            <image class="sheet-close-icon" src="/static/images/icon-close.png" mode="aspectFit" />
          </view>
        </view>

        <view v-if="!nodes.length" class="sheet-state">暂无付款节点</view>
        <view v-else class="node-sheet-list">
          <view v-for="node in nodes" :key="node.id" class="node-sheet-row">
            <view class="node-sheet-main">
              <view class="node-sheet-title">
                <text class="node-sheet-name">{{ node.name }}</text>
                <text class="node-sheet-badge" :class="`node-sheet-badge--${nodeTone(node)}`">
                  {{ nodeBadge(node) }}
                </text>
              </view>
              <text class="node-sheet-meta">¥{{ formatMoney(node.amount) }} · {{ nodeTriggerLabel(node) }}</text>
            </view>
            <view
              v-if="isPrimaryOwner && node.status === 'paid'"
              class="confirm-btn"
              @tap.stop="confirmNode(node)"
            >
              确认已支付
            </view>
          </view>
        </view>

        <view class="sheet-note">
          「已付款」只代表工长登记了线下收款，系统内不发生任何资金划转。
        </view>
      </view>
    </view>

    <!-- 待我处理 -->
    <view v-if="pendingSheetOpen" class="sheet-mask" @touchmove.stop.prevent="sheetSwipe.onMaskTouchMove" @tap="pendingSheetOpen = false">
      <view class="sheet" :style="sheetSwipeStyle" @tap.stop>
        <view class="sheet-handle" @touchstart="sheetSwipe.onTouchStart" @touchmove.stop.prevent="sheetSwipe.onTouchMove" @touchend="sheetSwipe.onTouchEnd" />
        <view class="sheet-head" @touchstart="sheetSwipe.onTouchStart" @touchmove.stop.prevent="sheetSwipe.onTouchMove" @touchend="sheetSwipe.onTouchEnd">
          <view>
            <text class="sheet-title">待我处理</text>
            <text class="sheet-sub">共 {{ pendingItems.length }} 项</text>
          </view>
          <view class="sheet-close" @tap="pendingSheetOpen = false">
            <image class="sheet-close-icon" src="/static/images/icon-close.png" mode="aspectFit" />
          </view>
        </view>

        <view class="pending-list pending-list--sheet">
          <view
            v-for="item in pendingItems"
            :key="item.key"
            class="pending-item"
            @tap="onPendingTap(item)"
          >
            <view class="pending-icon">
              <image class="pending-icon-img" src="/static/images/icon-document-amber.png" mode="aspectFit" />
            </view>
            <text class="pending-name">{{ item.name }}</text>
            <template v-if="item.type === 'payment'">
              <text class="pending-amount">¥{{ formatMoney(item.amount) }}</text>
              <text class="pending-badge">待确认</text>
            </template>
            <image class="pending-chevron" src="/static/images/icon-chevron-right.png" mode="aspectFit" />
          </view>
        </view>
      </view>
    </view>

    <!-- 对账单详情 -->
    <view v-if="recSheetOpen" class="sheet-mask" @touchmove.stop.prevent="sheetSwipe.onMaskTouchMove" @tap="closeReconciliation">
      <view class="sheet sheet--reconcile" :style="sheetSwipeStyle" @tap.stop>
        <view class="sheet-handle" @touchstart="sheetSwipe.onTouchStart" @touchmove.stop.prevent="sheetSwipe.onTouchMove" @touchend="sheetSwipe.onTouchEnd" />
        <view class="sheet-head" @touchstart="sheetSwipe.onTouchStart" @touchmove.stop.prevent="sheetSwipe.onTouchMove" @touchend="sheetSwipe.onTouchEnd">
          <view>
            <text class="sheet-title">{{ recDetail ? recPeriodLabel(recDetail) : '对账详情' }}</text>
            <text class="sheet-sub">{{ recDetail ? recDetail.statusLabel : '加载中…' }}</text>
          </view>
          <view class="sheet-close" @tap="closeReconciliation">
            <image class="sheet-close-icon" src="/static/images/icon-close.png" mode="aspectFit" />
          </view>
        </view>

        <scroll-view class="rec-scroll" scroll-y>
          <view v-if="recLoading" class="sheet-state"><gc-loading inline text="加载中" /></view>
          <view v-else-if="recError" class="sheet-state">
            {{ recError }}
            <button class="state-btn state-btn--small" @tap="reloadRecDetail">重试</button>
          </view>
          <template v-else-if="recDetail">
            <view class="rec-summary">
              <view class="rec-summary-item">
                <text class="rec-summary-label">收入</text>
                <text class="rec-summary-value rec-summary-value--green">¥{{ formatMoney(recDetail.incomeAmount) }}</text>
              </view>
              <view class="rec-summary-item">
                <text class="rec-summary-label">支出</text>
                <text class="rec-summary-value rec-summary-value--orange">¥{{ formatMoney(recDetail.expenseAmount) }}</text>
              </view>
            </view>

            <view v-if="recDetail.remark" class="rec-remark">{{ recDetail.remark }}</view>

            <view class="rec-detail-list">
              <text class="rec-detail-heading">明细（{{ recDetail.details.length }} 条）</text>
              <view v-for="row in recDetail.details" :key="row.id" class="rec-detail-row">
                <view class="rec-detail-top">
                  <text class="rec-detail-date">{{ formatDate(row.occurredAt) }}</text>
                  <text class="rec-detail-type" :class="`rec-detail-type--${row.type}`">
                    {{ row.typeLabel }}<template v-if="row.categoryLabel"> · {{ row.categoryLabel }}</template>
                  </text>
                  <text class="rec-detail-amount" :class="`rec-detail-amount--${row.type}`">
                    ¥{{ formatMoney(row.amount) }}
                  </text>
                </view>
                <text v-if="row.remark" class="rec-detail-remark">{{ row.remark }}</text>

                <view v-if="row.dispute" class="dispute-note">
                  <text class="dispute-note-label">异议</text>
                  <text class="dispute-note-text">{{ row.disputeRemark }}</text>
                </view>
                <view
                  v-else-if="canDisputeRow"
                  class="dispute-entry"
                  @tap.stop="startDispute(row)"
                >
                  有异议
                </view>

                <view v-if="disputeDetailId === row.id" class="dispute-box">
                  <textarea
                    v-model="disputeText"
                    class="dispute-input"
                    maxlength="500"
                    placeholder="请说明这一条哪里不对（必填）"
                    placeholder-class="dispute-placeholder"
                  />
                  <view class="dispute-actions">
                    <view class="dispute-cancel" @tap.stop="cancelDispute">取消</view>
                    <view
                      class="dispute-submit"
                      :class="{ 'dispute-submit--disabled': disputeSubmitting || !disputeText.trim() }"
                      @tap.stop="submitDispute"
                    >
                      {{ disputeSubmitting ? '提交中' : '提交异议' }}
                    </view>
                  </view>
                </view>
              </view>
            </view>

            <view v-if="recDetail.settlementPdfSignedPath" class="rec-pdf" @tap="openSettlement">
              <image class="rec-pdf-icon" src="/static/images/icon-document.png" mode="aspectFit" />
              <text>查看结算单</text>
              <image class="rec-pdf-chevron" src="/static/images/icon-chevron-right.png" mode="aspectFit" />
            </view>

            <view v-if="recDetail.confirmedAt" class="rec-confirmed-note">
              已由主业主确认于 {{ formatDateTime(recDetail.confirmedAt) }}，相关流水已锁定。
            </view>
          </template>
        </scroll-view>

        <view v-if="recDetail && !recLoading" class="rec-actions">
          <button
            v-if="canConfirmRec"
            class="sheet-primary"
            :disabled="recSubmitting"
            @tap="confirmRec"
          >
            {{ recSubmitting ? '确认中…' : '确认对账' }}
          </button>
          <view v-else-if="recDetail.status === 'confirmed'" class="rec-action-note">
            对账已确认，相关流水只能通过红冲更正。
          </view>
          <view v-else-if="isOwner && !isPrimaryOwner" class="rec-action-note">
            对账确认与异议需由主业主操作，临时业主可查看对账明细。
          </view>
          <view
            v-else-if="!isOwner && recDetail.status === 'disputed'"
            class="rec-action-note rec-action-note--warn"
          >
            主业主提出了 {{ recDetail.disputeCount }} 条异议，请处理后重新提交对账。
          </view>
          <view v-else-if="!isOwner" class="rec-action-note">等待主业主确认对账。</view>
          <view v-else-if="recDetail.disputeCount > 0" class="rec-action-note rec-action-note--warn">
            有 {{ recDetail.disputeCount }} 条明细存在异议，需工长处理后再确认。
          </view>
          <view v-else class="rec-action-note">当前状态不可确认。</view>
        </view>
      </view>
    </view>

    <!-- 工长：登记流水 -->
    <view v-if="entrySheetOpen" class="sheet-mask" @touchmove.stop.prevent="sheetSwipe.onMaskTouchMove" @tap="closeEntrySheet">
      <view class="sheet sheet--form" :style="sheetSwipeStyle" @tap.stop>
        <view class="sheet-handle" @touchstart="sheetSwipe.onTouchStart" @touchmove.stop.prevent="sheetSwipe.onTouchMove" @touchend="sheetSwipe.onTouchEnd" />
        <view class="sheet-head" @touchstart="sheetSwipe.onTouchStart" @touchmove.stop.prevent="sheetSwipe.onTouchMove" @touchend="sheetSwipe.onTouchEnd">
          <view>
            <text class="sheet-title">登记流水</text>
            <text class="sheet-sub">
              {{ entryForm.type === 'expense' ? '登记一笔施工支出' : '登记业主支付的款项' }}
            </text>
          </view>
          <view class="sheet-close" @tap="closeEntrySheet">
            <image class="sheet-close-icon" src="/static/images/icon-close.png" mode="aspectFit" />
          </view>
        </view>

        <scroll-view class="form-sheet-scroll" scroll-y>
          <view class="form-sheet-body gc-stagger">
            <view class="entry-type-row">
          <view class="entry-type-thumb" :style="entryTypeThumbStyle" />
          <view
            class="entry-type"
            :class="{ 'entry-type--active': entryForm.type === 'expense' }"
            @tap="setEntryType('expense')"
          >
            支出
          </view>
          <view
            class="entry-type"
            :class="{ 'entry-type--active': entryForm.type === 'income' }"
            @tap="setEntryType('income')"
          >
            收入
          </view>
        </view>

        <view class="form-field">
          <text class="form-label">金额（元）</text>
          <input
            v-model="entryForm.amount"
            class="form-input"
            type="digit"
            placeholder="例如：1280.00"
            placeholder-class="form-placeholder"
          />
        </view>

        <view class="form-field">
          <text class="form-label">发生日期</text>
          <picker mode="date" :value="entryForm.occurredAt" @change="onEntryDate">
            <view class="form-picker">{{ entryForm.occurredAt }}</view>
          </picker>
        </view>

        <view class="form-field">
          <text class="form-label">归属阶段</text>
          <picker
            mode="selector"
            :range="stageOptions"
            range-key="name"
            :value="entryStageIndex"
            @change="onEntryStage"
          >
            <view class="form-picker">{{ selectedStageLabel }}</view>
          </picker>
        </view>

        <view v-if="entryForm.type === 'expense'" class="form-field type-switch-field">
          <text class="form-label">支出分类</text>
          <view class="category-row">
            <view
              v-for="item in EXPENSE_CATEGORY_OPTIONS"
              :key="item.key"
              class="category-chip"
              :class="{ 'category-chip--active': entryForm.category === item.key }"
              @tap="entryForm.category = item.key"
            >
              {{ item.label }}
            </view>
          </view>
        </view>

        <view v-else class="form-field type-switch-field">
          <text class="form-label">关联付款节点</text>
          <picker
            v-if="incomeNodes.length"
            mode="selector"
            :range="incomeNodeLabels"
            :value="entryIncomeNodeIndex"
            @change="onIncomeNode"
          >
            <view class="form-picker">{{ selectedIncomeNodeLabel }}</view>
          </picker>
          <view v-else class="form-picker form-picker--disabled">暂无已解锁的付款节点</view>
          <text class="form-hint">
            {{ incomeNodeHint }}
          </text>
        </view>

        <view class="form-field">
          <text class="form-label">备注（选填）</text>
          <input
            v-model="entryForm.remark"
            class="form-input"
            maxlength="500"
            placeholder="例如：首批材料款"
            placeholder-class="form-placeholder"
          />
        </view>

        <view class="form-field">
          <text class="form-label">票据照片（选填）</text>
          <view v-if="entryReceiptPath" class="receipt-preview">
            <image class="receipt-image" :src="entryReceiptPath" mode="aspectFill" />
            <view class="receipt-remove" @tap="entryReceiptPath = ''">×</view>
          </view>
          <view v-else class="receipt-add" @tap="chooseEntryReceipt">
            <text class="receipt-plus">＋</text>
            <text class="receipt-label">上传票据</text>
          </view>
          <text class="form-hint">当前支持 1 张；上传后会由服务端添加水印。</text>
        </view>
          </view>
        </scroll-view>

        <view class="form-actions">
          <button class="form-cancel" @tap="closeEntrySheet">取消</button>
          <button class="form-submit" :disabled="entrySubmitting" @tap="submitEntry">
            {{ entrySubmitting ? '提交中…' : '保存流水' }}
          </button>
        </view>
      </view>
    </view>

    <!-- 工长：发起对账 -->
    <view v-if="initiateSheetOpen" class="sheet-mask" @touchmove.stop.prevent="sheetSwipe.onMaskTouchMove" @tap="closeInitiateSheet">
      <view class="sheet" :style="sheetSwipeStyle" @tap.stop>
        <view class="sheet-handle" @touchstart="sheetSwipe.onTouchStart" @touchmove.stop.prevent="sheetSwipe.onTouchMove" @touchend="sheetSwipe.onTouchEnd" />
        <view class="sheet-head" @touchstart="sheetSwipe.onTouchStart" @touchmove.stop.prevent="sheetSwipe.onTouchMove" @touchend="sheetSwipe.onTouchEnd">
          <view>
            <text class="sheet-title">发起对账</text>
            <text class="sheet-sub">把周期内的收支提交给业主核对</text>
          </view>
          <view class="sheet-close" @tap="closeInitiateSheet">
            <image class="sheet-close-icon" src="/static/images/icon-close.png" mode="aspectFit" />
          </view>
        </view>

        <view class="form-note">
          对账周期内必须已有流水；同一周期不能重复发起未终结的对账单。
        </view>

        <view class="form-field">
          <text class="form-label">开始日期</text>
          <picker mode="date" :value="initiateForm.periodStart" @change="onPeriodStart">
            <view class="form-picker">{{ initiateForm.periodStart }}</view>
          </picker>
        </view>

        <view class="form-field">
          <text class="form-label">结束日期</text>
          <picker mode="date" :value="initiateForm.periodEnd" @change="onPeriodEnd">
            <view class="form-picker">{{ initiateForm.periodEnd }}</view>
          </picker>
        </view>

        <view class="form-field">
          <text class="form-label">备注（选填）</text>
          <input
            v-model="initiateForm.remark"
            class="form-input"
            maxlength="500"
            placeholder="例如：10 月上半月对账"
            placeholder-class="form-placeholder"
          />
        </view>

        <view class="form-actions">
          <button class="form-cancel" @tap="closeInitiateSheet">取消</button>
          <button class="form-submit" :disabled="initiateSubmitting" @tap="submitInitiate">
            {{ initiateSubmitting ? '提交中…' : '提交给业主' }}
          </button>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed, onUnmounted, reactive, ref, watch } from 'vue'
import { onLoad, onShow, onPullDownRefresh } from '@dcloudio/uni-app'
import {
  myProjects,
  projectDetail,
  projectPaymentNodes,
  confirmPaymentNode,
} from '../../api/project'
import {
  fetchLedgerSummary,
  fetchLedgerEntries,
  fetchExpenseBreakdown,
  fetchStageLedger,
  createLedgerEntry,
  initiateReconciliation,
  fetchReconciliations,
  fetchReconciliationDetail,
  confirmReconciliation,
  disputeReconciliation,
} from '../../api/ledger'
import { resolveMediaUrl } from '../../api/request'
import { getToken } from '../../store/session'
import {
  getCurrentProject,
  setCurrentProject,
  clearCurrentProject,
} from '../../store/projectContext'
import { useSwipeClose } from '../../composables/useSwipeClose'

defineOptions({ name: 'LedgerPage' })

const TABS = [
  { key: 'overview', label: '概览' },
  { key: 'flow', label: '流水' },
  { key: 'reconcile', label: '对账' },
]

const FLOW_FILTERS = [
  { key: '', label: '全部' },
  { key: 'income', label: '收入' },
  { key: 'expense', label: '支出' },
]

const CATEGORY_SHORT_LABELS = {
  material: '材料',
  labor: '人工',
  transport: '运输',
  other: '其他',
}

const CATEGORY_LABELS = {
  material: '材料费',
  labor: '人工费',
  transport: '运输费',
  other: '其他',
}

const safeTop = ref(12)
const loading = ref(true)
const loadError = ref('')
const current = ref(getCurrentProject())
const detail = ref(null)
const summary = ref(null)
const nodes = ref([])
const stageLedger = ref(null)
const breakdown = ref(null)
const reconciliations = ref([])

const activeTab = ref('overview')
const flowFilter = ref('')

// 分段胶囊：用弹簧模型移动，带一点惯性过冲再回弹。
// 位置单位是「一个选项宽度」，所以 translateX(100%) 正好到下一项。
const thumbPos = ref(0)
const thumbStyle = computed(() => ({
  transform: `translateX(${thumbPos.value * 100}%)`,
}))
// 文字颜色跟随胶囊中心，而不是点击瞬间切换：
// 否则快速滑动时新标签会先变成白字、胶囊还没到，出现短暂“白字白底”。
const visualTabKey = computed(() => {
  const index = Math.max(0, Math.min(TABS.length - 1, Math.round(thumbPos.value)))
  return TABS[index].key
})
let thumbTimer = null
let thumbVelocity = 0
let thumbPosition = 0

const SPRING_STIFFNESS = 260
const SPRING_DAMPING = 22
const SPRING_DT = 1 / 60

function animateThumbTo(target) {
  if (thumbTimer) {
    clearTimeout(thumbTimer)
    thumbTimer = null
  }

  const step = () => {
    const force = -SPRING_STIFFNESS * (thumbPosition - target) - SPRING_DAMPING * thumbVelocity
    thumbVelocity += force * SPRING_DT
    thumbPosition += thumbVelocity * SPRING_DT
    thumbPos.value = thumbPosition

    if (Math.abs(thumbPosition - target) < 0.001 && Math.abs(thumbVelocity) < 0.01) {
      thumbPosition = target
      thumbVelocity = 0
      thumbPos.value = target
      thumbTimer = null
      return
    }
    thumbTimer = setTimeout(step, 16)
  }

  step()
}

watch(activeTab, (key) => {
  const target = TABS.findIndex((tab) => tab.key === key)
  if (target >= 0) animateThumbTo(target)
})

onUnmounted(() => {
  if (thumbTimer) clearTimeout(thumbTimer)
  thumbTimer = null
})
const entries = ref([])
const entriesTotal = ref(0)
const entriesPage = ref(1)
const entriesLoading = ref(false)
const entriesLoaded = ref(false)

const projectSheetOpen = ref(false)
const projectSheetLoading = ref(false)
const projectLoadError = ref('')
const projectOptions = ref([])
const contractSheetOpen = ref(false)
const nodesSheetOpen = ref(false)
const pendingSheetOpen = ref(false)

const recSheetOpen = ref(false)
const recLoading = ref(false)
const recError = ref('')
const recDetail = ref(null)
const recSubmitting = ref(false)
const disputeDetailId = ref(null)
const disputeText = ref('')
const disputeSubmitting = ref(false)

// 工长：登记流水 / 发起对账
const entrySheetOpen = ref(false)
const entrySubmitting = ref(false)
const entryReceiptPath = ref('')
const entryForm = reactive({
  type: 'expense',
  amount: '',
  occurredAt: todayDate(),
  stageId: '',
  category: 'material',
  paymentNodeId: '',
  remark: '',
})

// 支出 / 收入两段式开关：胶囊用 transform 滑动，和主页面分段控件保持同一手感
const entryTypeThumbStyle = computed(() => ({
  transform: entryForm.type === 'expense' ? 'translateX(0)' : 'translateX(100%)',
}))

const initiateSheetOpen = ref(false)
const initiateSubmitting = ref(false)
const initiateForm = reactive({
  periodStart: monthStartDate(),
  periodEnd: todayDate(),
  remark: '',
})

// 底部弹窗下滑关闭：只绑定把手 / 标题区，避免和表单滚动冲突
const sheetSwipe = useSwipeClose(() => closeActiveSheet())
const sheetSwipeStyle = sheetSwipe.style

function closeActiveSheet() {
  if (projectSheetOpen.value) {
    projectSheetOpen.value = false
    return
  }
  if (contractSheetOpen.value) {
    contractSheetOpen.value = false
    return
  }
  if (nodesSheetOpen.value) {
    nodesSheetOpen.value = false
    return
  }
  if (pendingSheetOpen.value) {
    pendingSheetOpen.value = false
    return
  }
  if (recSheetOpen.value) {
    closeReconciliation()
    return
  }
  if (entrySheetOpen.value) {
    closeEntrySheet()
    return
  }
  if (initiateSheetOpen.value) {
    closeInitiateSheet()
  }
}

const EXPENSE_CATEGORY_OPTIONS = [
  { key: 'material', label: '材料费' },
  { key: 'labor', label: '人工费' },
  { key: 'transport', label: '运输费' },
  { key: 'other', label: '其他' },
]

let bootstrapped = false
let confirmingNodeId = null
let entriesSeq = 0

const headerTitle = computed(() => (detail.value && detail.value.name) || (current.value && current.value.name) || '记账')

const myRole = computed(() => (detail.value && detail.value.myRole) || (current.value && current.value.role) || '')
const isOwner = computed(() => myRole.value === 'owner')
// 付款确认 / 对账确认与异议只属于主业主；临时业主仍可查看账目
const isPrimaryOwner = computed(() =>
  Boolean(
    (detail.value && detail.value.isPrimaryOwner) ||
      (current.value && current.value.isPrimaryOwner)
  )
)
const isForeman = computed(() => myRole.value === 'foreman')
const hasLedgerAccess = computed(() => isOwner.value || isForeman.value)

const heroLabels = computed(() =>
  isOwner.value
    ? { paid: '已支付', pending: '待支付', stagePaid: '已付' }
    : { paid: '已收款', pending: '待收', stagePaid: '已收' }
)

const pendingLabel = computed(() => {
  if (summary.value && summary.value.isOverReceived) return '已超收'
  return heroLabels.value.pending
})

const pendingItems = computed(() => {
  if (!hasLedgerAccess.value) return []

  const items = []
  if (isPrimaryOwner.value) {
    for (const node of nodes.value) {
      if (node.status !== 'paid') continue
      items.push({
        key: `payment-${node.id}`,
        type: 'payment',
        name: node.name,
        amount: node.amount,
        node,
      })
    }
  }

  for (const rec of reconciliations.value) {
    if (isPrimaryOwner.value && rec.status === 'pending') {
      items.push({
        key: `reconcile-${rec.id}`,
        type: 'reconciliation',
        name: `${recTitle(rec)}待核对`,
        reconciliation: rec,
      })
    }
    if (isForeman.value && rec.status === 'disputed') {
      items.push({
        key: `reconcile-${rec.id}`,
        type: 'reconciliation',
        name: `${recTitle(rec)}有异议待处理`,
        reconciliation: rec,
      })
    }
  }

  return items
})

const pendingPreview = computed(() => pendingItems.value.slice(0, 2))
const overviewNodes = computed(() => nodes.value.slice(0, 4))

const currentStageRow = computed(() => {
  const stages = (stageLedger.value && stageLedger.value.stages) || []
  if (!stages.length) return null

  const currentId = detail.value && detail.value.currentStageId
  const byId = stages.find((stage) => Number(stage.stageId) === Number(currentId))
  if (byId) return byId

  return stages.find((stage) => stage.gateStatus !== 'settled') || stages[stages.length - 1]
})

const stageOptions = computed(() => {
  const rows = (stageLedger.value && stageLedger.value.stages) || []
  return rows.map((row) => ({
    id: String(row.stageId),
    name: row.stageName || '未命名阶段',
    current: Number(row.stageId) === Number(detail.value && detail.value.currentStageId),
  }))
})

// 阶段型付款节点只能登记到它关联的阶段；未关联阶段的手工节点
// 由工长选择归属阶段。否则会出现「收入记在水电、节点却属于拆除改造」
// 的错配，阶段结算的应收与已收对不上。
const incomeNodes = computed(() =>
  nodes.value.filter((node) => {
    if (node.status !== 'unlocked') return false
    if (!node.triggerStageId) return true
    return String(node.triggerStageId) === String(entryForm.stageId)
  })
)

const incomeNodeHint = computed(() => {
  if (incomeNodes.value.length) {
    return '登记收入后，该付款节点会变为「待业主确认」。'
  }
  const stageName = selectedStageLabel.value
  return `当前阶段（${stageName}）暂无可关联的已解锁付款节点；该阶段验收通过后，关联它的付款节点才会解锁。`
})

const incomeNodeLabels = computed(() =>
  incomeNodes.value.map(
    (node) => `${node.name} · ¥${formatMoney(node.amount)} · ${nodeTriggerLabel(node)}`
  )
)

const selectedStageLabel = computed(() => {
  const stage = stageOptions.value.find((row) => row.id === String(entryForm.stageId))
  return stage ? `${stage.name}${stage.current ? '（当前阶段）' : ''}` : '请选择归属阶段'
})

const selectedIncomeNodeLabel = computed(() => {
  const node = incomeNodes.value.find((row) => String(row.id) === String(entryForm.paymentNodeId))
  if (!node) return '请选择付款节点'
  return `${node.name} · ¥${formatMoney(node.amount)}`
})

const entryStageIndex = computed(() => {
  const index = stageOptions.value.findIndex((row) => row.id === String(entryForm.stageId))
  return Math.max(0, index)
})

const entryIncomeNodeIndex = computed(() => {
  const index = incomeNodes.value.findIndex(
    (row) => String(row.id) === String(entryForm.paymentNodeId)
  )
  return Math.max(0, index)
})

const expenseRows = computed(() => {
  const rows = (breakdown.value && breakdown.value.byCategory) || []
  const total = rows.reduce((sum, row) => sum + Number(row.total || 0), 0)
  if (!total) return []

  return rows
    .filter((row) => Number(row.total) > 0)
    .map((row) => {
      const percent = Math.round((Number(row.total) / total) * 100)
      return {
        ...row,
        shortLabel: CATEGORY_SHORT_LABELS[row.category] || row.categoryLabel,
        percent: Math.max(1, percent),
      }
    })
})

const canConfirmRec = computed(() => {
  if (!recDetail.value || !isPrimaryOwner.value) return false
  const status = recDetail.value.status
  if (status !== 'pending' && status !== 'disputed') return false
  return Number(recDetail.value.disputeCount) === 0
})

const canDisputeRow = computed(() => {
  if (!isPrimaryOwner.value || !recDetail.value) return false
  const status = recDetail.value.status
  return status === 'pending' || status === 'disputed'
})

function formatMoney(value) {
  if (value === null || value === undefined || value === '') return '0'
  const text = String(value)
  const negative = text.startsWith('-')
  const unsigned = negative ? text.slice(1) : text
  const parts = unsigned.split('.')
  const integer = (parts[0] || '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const decimal = (parts[1] || '').padEnd(2, '0').slice(0, 2)
  const fraction = Number(decimal) === 0 ? '' : `.${decimal}`
  return `${negative ? '-' : ''}${integer}${fraction}`
}

function formatDate(value) {
  if (!value) return ''
  const text = String(value)
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10)
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return text
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function todayDate() {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

function monthStartDate() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
}

function formatDateTime(value) {
  if (!value) return ''
  const text = String(value).replace('T', ' ')
  if (text.length >= 16) return text.slice(0, 16)
  return text
}

function recTitle(rec) {
  if (rec && rec.scopeType === 'stage') return `${rec.stageName || '阶段'}结算`
  const start = formatDate(rec && rec.periodStart)
  const month = start ? Number(start.slice(5, 7)) : 0
  return month ? `${month} 月对账单` : '对账单'
}

function recPeriodLabel(rec) {
  if (!rec) return '对账周期'
  if (rec.scopeType === 'stage') {
    return rec.stageName ? `${rec.stageName} · 阶段结算` : '阶段结算'
  }
  const start = formatDate(rec.periodStart)
  const end = formatDate(rec.periodEnd)
  if (start && end) return `${start} ~ ${end}`
  return start || end || '对账周期'
}

function normalizeRecDetail(data) {
  if (!data) return data
  return {
    ...data,
    details: (data.details || []).map((row) => ({
      ...row,
      categoryLabel: row.category ? CATEGORY_LABELS[row.category] || row.category : null,
    })),
  }
}

function nodeTone(node) {
  if (node.status === 'confirmed') return 'done'
  if (node.status === 'paid') return 'active'
  if (node.status === 'unlocked') return 'unlocked'
  return 'pending'
}

function nodeBadge(node) {
  if (node.status === 'confirmed') return '已确认'
  if (node.status === 'paid') return isOwner.value ? '待您确认' : '待业主确认'
  if (node.status === 'unlocked') return '已解锁'
  return '未开始'
}

function nodeTriggerLabel(node) {
  if (node.triggerType !== 'stage_acceptance') return '由装修公司手动解锁'
  const stages = (stageLedger.value && stageLedger.value.stages) || []
  const stage = stages.find((item) => Number(item.stageId) === Number(node.triggerStageId))
  return stage ? `阶段验收通过后解锁 · ${stage.stageName}` : '阶段验收通过后解锁'
}

function flowAmount(entry) {
  const sign = entry.isReversal
    ? entry.type === 'income'
      ? '-'
      : '+'
    : entry.type === 'income'
      ? '+'
      : '-'
  return `${sign}¥${formatMoney(entry.amount)}`
}

function flowAmountClass(entry) {
  if (entry.isReversal) return 'flow-amount--reversal'
  return entry.type === 'income' ? 'flow-amount--income' : 'flow-amount--expense'
}

function isCurrentProject(project) {
  return Boolean(current.value && Number(current.value.id) === Number(project.id))
}

function showContractAmountInfo() {
  uni.showModal({
    title: '合同总额',
    content: '合同金额由装修公司管理员在项目档案中维护。本系统不包含在线支付，所有款项均走线下转账。',
    showCancel: false,
  })
}

function showBalanceInfo() {
  uni.showModal({
    title: '工程结余',
    content: `工程结余 = ${heroLabels.value.paid} − 施工支出，反映当前账面上的剩余金额，不是预算余额。`,
    showCancel: false,
  })
}

function showRoleHint() {
  uni.showModal({
    title: `我是${detail.value ? detail.value.myRoleLabel : ''}`,
    content:
      '角色在管理员邀请时固定，工长 / 监理不能跨项目改变；这里只做展示，不能切换身份。',
    showCancel: false,
  })
}

function resetLedgerData() {
  summary.value = null
  nodes.value = []
  stageLedger.value = null
  breakdown.value = null
  reconciliations.value = []
  entries.value = []
  entriesTotal.value = 0
  entriesPage.value = 1
  entriesLoaded.value = false
}

async function loadProjects() {
  projectSheetLoading.value = true
  projectLoadError.value = ''
  try {
    const data = await myProjects()
    const groups = (data && data.groups) || []
    const list = []
    const seen = new Set()

    for (const group of groups) {
      for (const item of group.items || []) {
        if (!item || seen.has(item.id)) continue
        seen.add(item.id)
        if (item.myRole === 'owner' || item.myRole === 'foreman') list.push(item)
      }
    }

    // 当前项目可能不在列表第一页/分组里，但仍可访问；补进切换列表避免「当前项目消失」
    if (detail.value && detail.value.myRole && !seen.has(detail.value.id)) {
      if (detail.value.myRole === 'owner' || detail.value.myRole === 'foreman') {
        list.unshift({
          id: detail.value.id,
          name: detail.value.name,
          address: detail.value.address,
          myRole: detail.value.myRole,
          myRoleLabel: detail.value.myRoleLabel,
        })
      }
    }

    projectOptions.value = list
  } catch (err) {
    projectLoadError.value = err.message || '项目加载失败'
    uni.showToast({ title: projectLoadError.value, icon: 'none' })
  } finally {
    projectSheetLoading.value = false
  }
}

function openProjectSheet() {
  projectSheetOpen.value = true
  loadProjects()
}

async function selectProject(project) {
  projectSheetOpen.value = false
  if (isCurrentProject(project)) return

  setCurrentProject(project)
  current.value = getCurrentProject()
  detail.value = null
  activeTab.value = 'overview'
  resetLedgerData()
  await load()
}

function setEntryType(type) {
  entryForm.type = type
  if (type === 'income') {
    if (!entryForm.paymentNodeId && incomeNodes.value.length) {
      entryForm.paymentNodeId = String(incomeNodes.value[0].id)
    }
  }
}

function openEntrySheet() {
  if (!isForeman.value || !detail.value) return
  if (!stageOptions.value.length) {
    uni.showToast({ title: '当前项目还没有阶段，无法登记流水', icon: 'none' })
    return
  }

  entryForm.type = 'expense'
  entryForm.amount = ''
  entryForm.occurredAt = todayDate()
  entryForm.category = 'material'
  entryForm.remark = ''
  entryReceiptPath.value = ''

  const current = stageOptions.value.find((row) => row.current)
  entryForm.stageId = (current || stageOptions.value[0]).id
  entryForm.paymentNodeId = incomeNodes.value.length
    ? String(incomeNodes.value[0].id)
    : ''
  entrySheetOpen.value = true
}

function closeEntrySheet() {
  if (entrySubmitting.value) return
  entrySheetOpen.value = false
}

function onEntryDate(event) {
  entryForm.occurredAt = event.detail.value
}

function onEntryStage(event) {
  const stage = stageOptions.value[Number(event.detail.value)]
  if (!stage) return
  entryForm.stageId = stage.id

  // 切换阶段后，原来选中的节点可能不属于新阶段；自动落到第一个可用节点，
  // 没有可用节点时清空，让「当前阶段暂无已解锁节点」的提示显示出来。
  if (entryForm.type === 'income') {
    const stillEligible = incomeNodes.value.some(
      (node) => String(node.id) === String(entryForm.paymentNodeId)
    )
    if (!stillEligible) {
      entryForm.paymentNodeId = incomeNodes.value.length ? String(incomeNodes.value[0].id) : ''
    }
  }
}

function onIncomeNode(event) {
  const node = incomeNodes.value[Number(event.detail.value)]
  if (!node) return
  entryForm.paymentNodeId = String(node.id)
  // 阶段型节点自带归属阶段，选中后把表单阶段同步过去（与后端校验一致）
  if (node.triggerStageId) entryForm.stageId = String(node.triggerStageId)
}

function chooseEntryReceipt() {
  uni.chooseImage({
    count: 1,
    sizeType: ['compressed'],
    sourceType: ['camera', 'album'],
    success(res) {
      entryReceiptPath.value = res.tempFilePaths[0]
    },
  })
}

async function submitEntry() {
  if (entrySubmitting.value || !detail.value) return

  const amount = entryForm.amount.trim()
  if (!/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) {
    uni.showToast({ title: '请输入正确的金额（最多两位小数）', icon: 'none' })
    return
  }
  if (!entryForm.stageId) {
    uni.showToast({ title: '请选择归属阶段', icon: 'none' })
    return
  }
  if (entryForm.type === 'income' && !entryForm.paymentNodeId) {
    uni.showToast({ title: '请选择关联付款节点', icon: 'none' })
    return
  }

  const payload = {
    type: entryForm.type,
    amount,
    occurredAt: entryForm.occurredAt,
    stageId: Number(entryForm.stageId),
    category: entryForm.type === 'expense' ? entryForm.category : undefined,
    paymentNodeId:
      entryForm.type === 'income' ? Number(entryForm.paymentNodeId) : undefined,
    remark: entryForm.remark.trim() || undefined,
  }

  entrySubmitting.value = true
  try {
    await createLedgerEntry(detail.value.id, payload, entryReceiptPath.value)
    entrySheetOpen.value = false
    entryReceiptPath.value = ''
    uni.showToast({ title: '流水已登记', icon: 'success' })
    await load({ silent: true })
  } catch (err) {
    uni.showToast({ title: err.message || '登记失败', icon: 'none' })
  } finally {
    entrySubmitting.value = false
  }
}

function openInitiateSheet() {
  if (!isForeman.value) return
  initiateForm.periodStart = monthStartDate()
  initiateForm.periodEnd = todayDate()
  initiateForm.remark = ''
  initiateSheetOpen.value = true
}

function closeInitiateSheet() {
  if (initiateSubmitting.value) return
  initiateSheetOpen.value = false
}

function onPeriodStart(event) {
  initiateForm.periodStart = event.detail.value
}

function onPeriodEnd(event) {
  initiateForm.periodEnd = event.detail.value
}

async function submitInitiate() {
  if (initiateSubmitting.value || !detail.value) return

  if (!initiateForm.periodStart || !initiateForm.periodEnd) {
    uni.showToast({ title: '请选择对账周期', icon: 'none' })
    return
  }
  if (initiateForm.periodStart > initiateForm.periodEnd) {
    uni.showToast({ title: '开始日期不得晚于结束日期', icon: 'none' })
    return
  }

  initiateSubmitting.value = true
  try {
    await initiateReconciliation(detail.value.id, {
      periodStart: initiateForm.periodStart,
      periodEnd: initiateForm.periodEnd,
      remark: initiateForm.remark.trim(),
    })
    initiateSheetOpen.value = false
    uni.showToast({ title: '对账单已提交', icon: 'success' })
    await load({ silent: true })
  } catch (err) {
    uni.showToast({ title: err.message || '发起对账失败', icon: 'none' })
  } finally {
    initiateSubmitting.value = false
  }
}

async function load(options = {}) {
  const silent = options.silent === true

  if (!getToken()) {
    uni.redirectTo({ url: '/pages/login/index' })
    return
  }

  const context = getCurrentProject()
  current.value = context

  if (!context) {
    resetLedgerData()
    detail.value = null
    loadError.value = ''
    loading.value = false
    await loadProjects()
    return
  }

  if (!silent) loading.value = true
  loadError.value = ''

  try {
    const project = await projectDetail(context.id)
    detail.value = project
    current.value = {
      ...context,
      id: project.id,
      name: project.name,
      tenantId: project.tenantId,
      role: project.myRole,
    }
    setCurrentProject({
      ...context,
      id: project.id,
      name: project.name,
      tenantId: project.tenantId,
      myRole: project.myRole,
      myRoleLabel: project.myRoleLabel,
    })

    if (project.myRole !== 'owner' && project.myRole !== 'foreman') {
      resetLedgerData()
      return
    }

    const [summaryData, nodeData, stageData, breakdownData, recData] = await Promise.all([
      fetchLedgerSummary(project.id),
      projectPaymentNodes(project.id),
      fetchStageLedger(project.id),
      fetchExpenseBreakdown(project.id),
      fetchReconciliations(project.id),
    ])

    summary.value = summaryData
    nodes.value = (nodeData && nodeData.nodes) || []
    stageLedger.value = stageData
    breakdown.value = breakdownData
    reconciliations.value = (recData && recData.list) || []

    // 对账确认会让流水变成「已锁定」，返回流水页时必须重新取，
    // 否则会拿缓存里的旧 locked 状态继续显示
    if (activeTab.value === 'flow') {
      await loadEntries(true)
    }
  } catch (err) {
    if (err.statusCode === 404) {
      clearCurrentProject()
      current.value = null
      detail.value = null
      resetLedgerData()
      await loadProjects()
      uni.showToast({ title: '上次进入的项目已不可用', icon: 'none' })
    } else {
      loadError.value = err.message || '账目加载失败'
    }
  } finally {
    loading.value = false
  }
}

function reload() {
  load()
}

function goProjects() {
  uni.switchTab({ url: '/pages/projects/index' })
}

async function loadEntries(reset = false) {
  if (!detail.value || !hasLedgerAccess.value) return

  const seq = ++entriesSeq
  entriesLoading.value = true
  const page = reset ? 1 : entriesPage.value + 1

  try {
    const result = await fetchLedgerEntries(detail.value.id, {
      page,
      pageSize: 20,
      type: flowFilter.value || undefined,
    })

    // 快速切换筛选时可能有多个请求在飞，只接受最后一次的结果
    if (seq !== entriesSeq) return

    const list = (result && result.list) || []
    entries.value = reset ? list : entries.value.concat(list)
    entriesPage.value = (result && result.page) || page
    entriesTotal.value = (result && result.total) || 0
    entriesLoaded.value = true
  } catch (err) {
    if (seq !== entriesSeq) return
    uni.showToast({ title: err.message || '流水加载失败', icon: 'none' })
  } finally {
    if (seq === entriesSeq) entriesLoading.value = false
  }
}

function switchTab(key) {
  activeTab.value = key
  if (key === 'flow' && !entriesLoaded.value) loadEntries(true)
}

function changeFlowFilter(key) {
  if (flowFilter.value === key) return
  flowFilter.value = key
  entriesLoaded.value = false
  loadEntries(true)
}

function previewReceipt(entry, index) {
  const urls = (entry.receiptImages || []).map((image) => resolveMediaUrl(image.url)).filter(Boolean)
  if (!urls.length) return
  uni.previewImage({ urls, current: urls[index] || urls[0] })
}

function confirmNode(node) {
  if (confirmingNodeId) return
  if (!isPrimaryOwner.value) {
    uni.showToast({ title: '付款确认需由主业主操作', icon: 'none' })
    return
  }

  uni.showModal({
    title: '确认已支付',
    content: `确认已收到「${node.name}」¥${formatMoney(node.amount)}？系统只记录状态，不进行任何资金划转。`,
    success: async (res) => {
      if (!res.confirm) return
      confirmingNodeId = node.id
      try {
        await confirmPaymentNode(detail.value.id, node.id)
        uni.showToast({ title: '已确认', icon: 'success' })
        await load({ silent: true })
        if (recSheetOpen.value && recDetail.value) await reloadRecDetail()
      } catch (err) {
        uni.showToast({ title: err.message || '确认失败', icon: 'none' })
      } finally {
        confirmingNodeId = null
      }
    },
  })
}

function openNodesSheet() {
  nodesSheetOpen.value = true
}

function onPendingTap(item) {
  pendingSheetOpen.value = false
  if (item.type === 'payment') {
    confirmNode(item.node)
    return
  }
  openReconciliation(item.reconciliation)
}

async function openReconciliation(rec) {
  const id = rec && typeof rec === 'object' ? rec.id : rec

  // 阶段结算单有独立页面（应收、异议、结清下一阶段），不要塞进周期对账的详情面板
  if (rec && typeof rec === 'object' && rec.scopeType === 'stage') {
    uni.navigateTo({
      url: `/pages/settlement/detail?id=${id}`,
      fail: () => uni.showToast({ title: '阶段结算暂不可用', icon: 'none' }),
    })
    return
  }

  recSheetOpen.value = true
  recLoading.value = true
  recError.value = ''
  recDetail.value = null
  disputeDetailId.value = null
  disputeText.value = ''

  try {
    recDetail.value = normalizeRecDetail(await fetchReconciliationDetail(id))
  } catch (err) {
    recError.value = err.message || '对账单加载失败'
  } finally {
    recLoading.value = false
  }
}

async function reloadRecDetail() {
  if (!recDetail.value) return
  const id = recDetail.value.id
  recLoading.value = true
  recError.value = ''
  try {
    recDetail.value = normalizeRecDetail(await fetchReconciliationDetail(id))
  } catch (err) {
    recError.value = err.message || '对账单加载失败'
  } finally {
    recLoading.value = false
  }
}

function closeReconciliation() {
  recSheetOpen.value = false
  recDetail.value = null
  recError.value = ''
  disputeDetailId.value = null
  disputeText.value = ''
}

function confirmRec() {
  if (!recDetail.value || !canConfirmRec.value || recSubmitting.value) return

  uni.showModal({
    title: '确认对账',
    content: '确认后本周期流水将被锁定，之后只能通过红冲更正。确认前请确保明细已经核对无误。',
    success: async (res) => {
      if (!res.confirm) return
      recSubmitting.value = true
      try {
        await confirmReconciliation(recDetail.value.id)
        uni.showToast({ title: '对账已确认', icon: 'success' })
        entriesLoaded.value = false
        await load({ silent: true })
        await reloadRecDetail()
      } catch (err) {
        uni.showToast({ title: err.message || '确认失败', icon: 'none' })
      } finally {
        recSubmitting.value = false
      }
    },
  })
}

function startDispute(row) {
  disputeDetailId.value = row.id
  disputeText.value = ''
}

function cancelDispute() {
  disputeDetailId.value = null
  disputeText.value = ''
}

async function submitDispute() {
  if (!recDetail.value || !disputeDetailId.value || disputeSubmitting.value) return
  const remark = disputeText.value.trim()
  if (!remark) {
    uni.showToast({ title: '请填写异议说明', icon: 'none' })
    return
  }

  disputeSubmitting.value = true
  try {
    await disputeReconciliation(recDetail.value.id, {
      detailId: disputeDetailId.value,
      remark,
    })
    uni.showToast({ title: '已提交异议', icon: 'success' })
    cancelDispute()
    await load({ silent: true })
    await reloadRecDetail()
  } catch (err) {
    uni.showToast({ title: err.message || '提交失败', icon: 'none' })
  } finally {
    disputeSubmitting.value = false
  }
}

function openSettlement() {
  const path = recDetail.value && recDetail.value.settlementPdfSignedPath
  if (!path) {
    uni.showToast({ title: '结算单尚未生成', icon: 'none' })
    return
  }

  const url = resolveMediaUrl(path)

  // #ifdef H5
  window.open(url, '_blank')
  // #endif
  // #ifndef H5
  uni.showLoading({ title: '下载中…' })
  uni.downloadFile({
    url,
    success: (res) => {
      uni.hideLoading()
      uni.openDocument({
        filePath: res.tempFilePath,
        fileType: 'pdf',
        showMenu: true,
      })
    },
    fail: () => {
      uni.hideLoading()
      uni.showToast({ title: '结算单下载失败', icon: 'none' })
    },
  })
  // #endif
}

onLoad(() => {
  const info = uni.getSystemInfoSync()
  safeTop.value = info.statusBarHeight || 12

  bootstrapped = true
  load()
})

onShow(() => {
  if (bootstrapped && !loading.value) load({ silent: true })
})

onPullDownRefresh(async () => {
  try {
    await load({ silent: true })
    if (activeTab.value === 'flow') await loadEntries(true)
  } finally {
    uni.stopPullDownRefresh()
  }
})
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  padding-bottom: calc(#{dp(24)} + env(safe-area-inset-bottom));
  background: #faf7f4;
}

/* ── 导航 ── */
.nav {
  position: sticky;
  top: 0;
  z-index: 30;
  padding-right: dp(14);
  padding-bottom: dp(8);
  padding-left: dp(16);
  background: rgba(250, 247, 244, 0.86);
  -webkit-backdrop-filter: blur(22px) saturate(180%);
  backdrop-filter: blur(22px) saturate(180%);
  border-bottom: 1px solid rgba(255, 255, 255, 0.6);
  box-shadow: 0 dp(6) dp(18) rgba(94, 45, 22, 0.04);
}

.nav-main {
  display: flex;
  align-items: center;
  min-height: dp(34);
}

.project-trigger {
  display: flex;
  align-items: center;
  min-width: 0;
  max-width: calc(100% - #{dp(78)});
}

.project-name {
  overflow: hidden;
  min-width: 0;
  color: #241C17;
  font-size: dp(20);
  font-weight: 800;
  letter-spacing: dp(-0.3);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.project-caret {
  width: dp(16);
  height: dp(16);
  margin-left: dp(3);
  flex-shrink: 0;
}

.role-pill {
  margin-left: dp(8);
  padding: dp(2) dp(8);
  border-radius: dp(999);
  background: #fdebe4;
  color: #eb5c20;
  font-size: dp(11);
  font-weight: 500;
  white-space: nowrap;
  flex-shrink: 0;
}

/* 小程序右上角有微信原生胶囊，标题区往左让位 */
/* #ifdef MP-WEIXIN */
.nav {
  padding-right: dp(96);
}
/* #endif */

.content {
  padding: 0 dp(14);
}

/* ── 状态 ── */
.state-block {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: dp(70) dp(28) dp(30);
  text-align: center;
}

.state-icon {
  width: dp(54);
  height: dp(54);
  margin-bottom: dp(14);
}

.state-title {
  color: #241c17;
  font-size: dp(16);
  font-weight: 700;
}

.state-text {
  margin-top: dp(8);
  color: #8b8179;
  font-size: dp(12);
  line-height: 1.7;
}

.state-btn {
  min-width: dp(150);
  height: dp(38);
  margin-top: dp(16);
  border: none;
  border-radius: dp(999);
  background: #eb5c20;
  color: #fff;
  font-size: dp(13);
  line-height: dp(38);
}

.state-btn--ghost {
  margin-top: dp(10);
  border: 1px solid #f6c5ae;
  background: #fff;
  color: #eb5c20;
}

.state-btn--small {
  min-width: dp(90);
  height: dp(32);
  margin-top: dp(10);
  font-size: dp(12);
  line-height: dp(32);
}

.restricted-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(64);
  height: dp(64);
  margin-bottom: dp(16);
  border-radius: dp(999);
  background: #fdebe4;
}

.restricted-icon-img {
  width: dp(32);
  height: dp(32);
}

.project-picker {
  width: 100%;
  margin-top: dp(20);
  overflow: hidden;
  @include glass-surface(dp(14), 18px);
}

.project-picker-row {
  display: flex;
  align-items: center;
  padding: dp(14);
  border-bottom: 1px solid #f3efea;
  text-align: left;
}

.project-picker-row:last-child {
  border-bottom: none;
}

.project-picker-main {
  flex: 1;
  min-width: 0;
}

.project-picker-name {
  display: block;
  overflow: hidden;
  color: #241c17;
  font-size: dp(13);
  font-weight: 600;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.project-picker-meta {
  display: block;
  margin-top: dp(3);
  overflow: hidden;
  color: #8b8179;
  font-size: dp(11);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.project-picker-chevron {
  width: dp(14);
  height: dp(14);
  margin-left: dp(8);
  flex-shrink: 0;
}

/* ── 合同总览 ── */
.hero {
  position: relative;
  overflow: hidden;
  margin-bottom: dp(12);
  padding: dp(16);
  border-radius: dp(18);
  background: linear-gradient(135deg, #f07a3a 0%, #d95218 48%, #eb5c20 100%);
  box-shadow: 0 dp(6) dp(16) rgba(235, 92, 32, 0.18);
}

.hero-mark {
  position: absolute;
  top: dp(-12);
  right: dp(-24);
  width: dp(170);
  height: dp(170);
  pointer-events: none;
}

.hero-top {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.hero-label {
  display: flex;
  align-items: center;
  color: #f8cdb9;
  font-size: dp(13);
}

.hero-info {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: dp(13);
  height: dp(13);
  margin-left: dp(3);
  border: 1px solid rgba(255, 255, 255, 0.55);
  border-radius: dp(999);
  color: rgba(255, 255, 255, 0.8);
  font-size: dp(9);
  font-style: normal;
  line-height: 1;
}

.hero-info--gray {
  border-color: #cfc6bd;
  color: #8b8179;
}

.contract-link {
  display: flex;
  align-items: center;
  padding: dp(3) dp(9);
  border: 1px solid rgba(255, 255, 255, 0.24);
  border-radius: dp(999);
  background: rgba(255, 255, 255, 0.15);
  color: rgba(255, 255, 255, 0.95);
  font-size: dp(11);
}

.contract-link-icon {
  width: dp(12);
  height: dp(12);
  margin-left: dp(1);
}

.hero-amount {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: baseline;
  margin-top: dp(8);
  color: #fff;
  font-size: dp(32);
  font-weight: 800;
  letter-spacing: dp(-0.6);
  line-height: 1.15;
  font-variant-numeric: tabular-nums;
}

.hero-yen {
  margin-right: dp(3);
  font-size: dp(18);
  font-weight: 700;
}

.hero-breakdown {
  position: relative;
  z-index: 2;
  display: flex;
  margin-top: dp(14);
  padding: dp(10) dp(4);
  @include glass-surface(dp(12), 18px);
  background: linear-gradient(
    135deg,
    rgba(255, 255, 255, 0.96) 0%,
    rgba(255, 255, 255, 0.84) 100%
  );
  box-shadow:
    0 dp(4) dp(14) rgba(94, 45, 22, 0.08),
    inset 0 1px 0 rgba(255, 255, 255, 0.96);
}

.hero-cell {
  flex: 1;
  min-width: 0;
  padding: 0 dp(6);
}

.hero-cell + .hero-cell {
  border-left: 1px solid #f1ebe5;
  padding-left: dp(8);
}

.hero-cell-label-row {
  display: flex;
  align-items: center;
}

.hero-cell-label {
  display: block;
  overflow: hidden;
  color: #8b8179;
  font-size: dp(10);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.hero-cell-value {
  display: block;
  margin-top: dp(3);
  overflow: hidden;
  color: #eb5c20;
  font-size: dp(12);
  font-weight: 700;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-variant-numeric: tabular-nums;
}

.hero-cell-value--green {
  color: #00b42a;
}

.hero-cell-value--orange {
  color: #ff7d00;
}

.hero-cell-value--danger {
  color: #f53f3f;
}

/* AC-L10：汇总始终反映全量流水，页面要明确这一点 */
.scope-note {
  display: block;
  margin: dp(-4) dp(2) dp(10);
  color: #a79c92;
  font-size: dp(9);
  line-height: 1.4;
}

/* ── 待我处理 ── */
.pending-card {
  margin-bottom: dp(12);
  padding: dp(14);
  @include glass-surface(dp(14), 18px);
  background: linear-gradient(
    135deg,
    rgba(255, 249, 243, 0.9) 0%,
    rgba(255, 253, 249, 0.7) 100%
  );
  box-shadow:
    0 dp(4) dp(16) rgba(255, 125, 0, 0.06),
    inset 0 1px 0 rgba(255, 255, 255, 0.94);
}

.pending-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: dp(10);
}

.pending-title {
  display: flex;
  align-items: center;
  color: #241c17;
  font-size: dp(14);
  font-weight: 700;
}

.pending-warning {
  width: dp(16);
  height: dp(16);
  margin-right: dp(5);
}

.pending-count {
  display: flex;
  align-items: center;
  color: #8b8179;
  font-size: dp(11);
}

.pending-count-chevron {
  width: dp(12);
  height: dp(12);
  margin-left: dp(1);
}

.pending-list {
  display: flex;
  flex-direction: column;
  gap: dp(8);
}

.pending-list--sheet {
  padding-top: dp(14);
}

.pending-item {
  display: flex;
  align-items: center;
  padding: dp(10);
  @include glass-surface(dp(10), 16px);
  border-color: rgba(253, 229, 204, 0.7);
}

.pending-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(28);
  height: dp(28);
  margin-right: dp(9);
  border-radius: dp(7);
  background: #fff2e5;
  flex-shrink: 0;
}

.pending-icon-img {
  width: dp(15);
  height: dp(15);
}

.pending-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: #2b2119;
  font-size: dp(12);
  font-weight: 500;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.pending-amount {
  margin-left: dp(6);
  color: #ff7d00;
  font-size: dp(12);
  font-weight: 700;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.pending-badge {
  margin-left: dp(5);
  padding: dp(1) dp(5);
  border-radius: dp(3);
  background: #fff0e0;
  color: #ff7d00;
  font-size: dp(10);
  white-space: nowrap;
}

.pending-chevron {
  width: dp(13);
  height: dp(13);
  margin-left: dp(4);
  flex-shrink: 0;
}

/* ── 分段切换 ── */
.segment {
  position: relative;
  display: flex;
  overflow: hidden;
  margin: dp(2) 0 dp(12);
  padding: dp(4);
  @include glass-surface(dp(999), 18px);
}

/* 胶囊背景。位置由 JS 弹簧模型驱动，translateX(100%) 对应一个选项宽度 */
.segment-thumb {
  position: absolute;
  z-index: 0;
  top: dp(4);
  bottom: dp(4);
  left: dp(4);
  width: calc((100% - 16rpx) / 3);
  border-radius: dp(999);
  background: #eb5c20;
  box-shadow: 0 dp(2) dp(6) rgba(235, 92, 32, 0.25);
  will-change: transform;
}

.segment-item {
  position: relative;
  z-index: 1;
  flex: 1;
  padding: dp(7) 0;
  border-radius: dp(999);
  color: #51463e;
  font-size: dp(12);
  font-weight: 500;
  text-align: center;
  transition: color 160ms ease;
}

.segment-item--active {
  color: #fff;
  font-weight: 600;
}

/* ── 卡片与 section ── */
.card {
  margin-bottom: dp(12);
  padding: dp(14);
  @include glass-surface(dp(14), 18px);
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: dp(12);
}

.section-title-wrap {
  display: flex;
  align-items: center;
  min-width: 0;
}

.section-icon {
  width: dp(16);
  height: dp(16);
  margin-right: dp(5);
  flex-shrink: 0;
}

.section-title {
  color: #241c17;
  font-size: dp(14);
  font-weight: 700;
}

.section-link {
  display: flex;
  align-items: center;
  color: #8b8179;
  font-size: dp(11);
  white-space: nowrap;
}

.section-chevron {
  width: dp(12);
  height: dp(12);
  margin-left: dp(1);
}

.section-pill {
  max-width: dp(120);
  overflow: hidden;
  padding: dp(2) dp(7);
  border-radius: dp(999);
  background: #fdebe4;
  color: #eb5c20;
  font-size: dp(10);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.card-empty {
  padding: dp(14) 0 dp(8);
  color: #a79c92;
  font-size: dp(12);
  text-align: center;
}

/* ── 付款节点时间线 ── */
.milestones {
  padding-top: dp(2);
}

.milestone {
  position: relative;
  display: flex;
  align-items: center;
  min-height: dp(40);
  padding-left: dp(30);
}

.milestone:not(.milestone--last)::after {
  content: '';
  position: absolute;
  top: dp(24);
  bottom: dp(-6);
  left: dp(9);
  width: dp(2);
  background: #e8e1da;
  z-index: 0;
}

.milestone--done:not(.milestone--last)::after {
  background: #00b42a;
}

.milestone-dot {
  position: absolute;
  top: dp(9);
  left: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(20);
  height: dp(20);
  border-radius: dp(999);
  background: #cfc6bd;
}

.milestone-dot--done {
  background: #00b42a;
}

.milestone-dot--active {
  border: 2px solid #ff7d00;
  background: #fff;
}

.milestone-dot--unlocked {
  border: 2px solid #eb5c20;
  background: #fff;
}

.milestone-dot--pending {
  background: #cfc6bd;
}

.milestone-check {
  width: dp(11);
  height: dp(11);
}

.milestone-core {
  width: dp(7);
  height: dp(7);
  border-radius: dp(999);
}

.milestone-core--active {
  background: #ff7d00;
}

.milestone-core--unlocked {
  background: #eb5c20;
}

.milestone-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: #51463e;
  font-size: dp(12);
  font-weight: 500;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.milestone-name--active {
  color: #241c17;
  font-weight: 700;
}

.milestone-actions {
  display: flex;
  align-items: center;
  margin-left: dp(8);
  flex-shrink: 0;
}

.milestone-badge {
  padding: dp(2) dp(6);
  border-radius: dp(3);
  font-size: dp(10);
  font-weight: 500;
  white-space: nowrap;
}

.milestone-badge--done {
  background: #e8ffea;
  color: #00b42a;
}

.milestone-badge--active {
  background: #fff0e0;
  color: #ff7d00;
}

.milestone-badge--unlocked {
  background: #fdebe4;
  color: #eb5c20;
}

.milestone-badge--pending {
  background: #f3efea;
  color: #8b8179;
}

.confirm-btn {
  margin-left: dp(6);
  padding: dp(4) dp(8);
  border-radius: dp(6);
  background: #eb5c20;
  color: #fff;
  font-size: dp(10);
  font-weight: 500;
  white-space: nowrap;
}

.milestone-chevron {
  width: dp(12);
  height: dp(12);
  margin-left: dp(2);
}

/* ── 本阶段账目 ── */
.stage-metrics {
  display: flex;
  flex-direction: column;
  gap: dp(8);
}

.stage-tile {
  display: flex;
  align-items: center;
  padding: dp(10);
  @include glass-surface(dp(10), 14px);
  background: linear-gradient(
    135deg,
    rgba(255, 255, 255, 0.84) 0%,
    rgba(250, 247, 243, 0.62) 100%
  );
}

.stage-metric {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
}

.stage-metric-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(24);
  height: dp(24);
  margin-right: dp(7);
  flex-shrink: 0;
}

.stage-metric-img {
  width: dp(24);
  height: dp(24);
}

.stage-metric-text {
  min-width: 0;
}

.stage-metric-label {
  display: block;
  color: #8b8179;
  font-size: dp(9);
  white-space: nowrap;
}

.stage-metric-value {
  display: block;
  margin-top: dp(1);
  overflow: hidden;
  color: #241c17;
  font-size: dp(11);
  font-weight: 700;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-variant-numeric: tabular-nums;
}

.stage-divider {
  width: 1px;
  height: dp(22);
  margin: 0 dp(8);
  background: #e8e1da;
  flex-shrink: 0;
}

/* ── 支出构成 ── */
.expense-list {
  display: flex;
  flex-direction: column;
  gap: dp(10);
}

.expense-row {
  display: flex;
  align-items: center;
}

.expense-label {
  width: dp(36);
  color: #51463e;
  font-size: dp(11);
  font-weight: 500;
}

.expense-track {
  flex: 1;
  height: dp(8);
  margin: 0 dp(8);
  overflow: hidden;
  border-radius: dp(999);
  background: #f3efea;
}

.expense-fill {
  height: 100%;
  border-radius: dp(999);
  background: #eb5c20;
}

.expense-percent {
  width: dp(30);
  color: #51463e;
  font-size: dp(11);
  font-weight: 500;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

/* ── 流水 ── */
.tab-panel {
  padding-bottom: dp(4);
}

.filter-row {
  display: flex;
  gap: dp(8);
  margin-bottom: dp(10);
}

.filter-chip {
  padding: dp(5) dp(12);
  border: 1px solid rgba(255, 255, 255, 0.72);
  border-radius: dp(999);
  background: linear-gradient(
    135deg,
    rgba(255, 255, 255, 0.9) 0%,
    rgba(255, 255, 255, 0.66) 100%
  );
  -webkit-backdrop-filter: blur(14px) saturate(170%);
  backdrop-filter: blur(14px) saturate(170%);
  color: #51463e;
  font-size: dp(11);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.9);
}

.filter-chip--active {
  border-color: #eb5c20;
  background: #fdebe4;
  color: #eb5c20;
  font-weight: 600;
}

.empty-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: dp(30) dp(20);
}

.empty-icon {
  width: dp(36);
  height: dp(36);
  margin-bottom: dp(10);
  opacity: 0.6;
}

.empty-title {
  color: #241c17;
  font-size: dp(13);
  font-weight: 600;
}

.empty-text {
  margin-top: dp(6);
  color: #8b8179;
  font-size: dp(11);
  line-height: 1.7;
  text-align: center;
}

.flow-list {
  display: flex;
  flex-direction: column;
  gap: dp(10);
}

.flow-card {
  padding: dp(13);
  @include glass-surface(dp(12), 16px);
}

.flow-top {
  display: flex;
  align-items: center;
}

.flow-type {
  padding: dp(2) dp(6);
  border-radius: dp(3);
  font-size: dp(10);
  font-weight: 500;
}

.flow-type--income {
  background: #e8ffea;
  color: #00b42a;
}

.flow-type--expense {
  background: #fff0e0;
  color: #ff7d00;
}

.flow-reversal {
  margin-left: dp(4);
  padding: dp(2) dp(5);
  border-radius: dp(3);
  background: #ffece8;
  color: #f53f3f;
  font-size: dp(9);
}

.flow-date {
  margin-left: dp(6);
  color: #8b8179;
  font-size: dp(10);
}

.flow-amount {
  margin-left: auto;
  font-size: dp(13);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.flow-amount--income {
  color: #00b42a;
}

.flow-amount--expense {
  color: #ff7d00;
}

.flow-amount--reversal {
  color: #8b8179;
  text-decoration: line-through;
}

.flow-meta {
  margin-top: dp(5);
  color: #8b8179;
  font-size: dp(10);
}

.flow-meta-item {
  margin-left: dp(2);
}

.flow-remark {
  display: block;
  margin-top: dp(6);
  color: #51463e;
  font-size: dp(11);
  line-height: 1.6;
}

.flow-receipts {
  display: flex;
  gap: dp(5);
  margin-top: dp(7);
}

.flow-receipt {
  width: dp(44);
  height: dp(44);
  border-radius: dp(6);
  background: #f3efea;
}

.flow-flags {
  display: flex;
  align-items: center;
  gap: dp(4);
  margin-top: dp(7);
  color: #8b8179;
  font-size: dp(9);
}

.flow-lock {
  width: dp(10);
  height: dp(10);
}

.flow-flag-reversal {
  color: #f53f3f;
}

.load-more {
  padding: dp(12) 0 dp(4);
  color: #eb5c20;
  font-size: dp(12);
  text-align: center;
}

/* ── 对账列表 ── */
.rec-list {
  display: flex;
  flex-direction: column;
  gap: dp(10);
}

.rec-card {
  padding: dp(13);
  @include glass-surface(dp(12), 16px);
}

.rec-top {
  display: flex;
  align-items: center;
}

.rec-period {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: #241c17;
  font-size: dp(12);
  font-weight: 700;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.rec-status {
  margin-left: dp(6);
  padding: dp(2) dp(6);
  border-radius: dp(3);
  font-size: dp(10);
  font-weight: 500;
  white-space: nowrap;
}

.rec-status--pending {
  background: #fff0e0;
  color: #ff7d00;
}

.rec-status--confirmed {
  background: #e8ffea;
  color: #00b42a;
}

.rec-status--disputed {
  background: #ffece8;
  color: #f53f3f;
}

.rec-status--draft {
  background: #f3efea;
  color: #8b8179;
}

.rec-chevron {
  width: dp(12);
  height: dp(12);
  margin-left: dp(3);
}

.rec-amounts {
  display: flex;
  gap: dp(24);
  margin-top: dp(9);
}

.rec-amount-item {
  display: flex;
  align-items: baseline;
}

.rec-amount-label {
  color: #8b8179;
  font-size: dp(10);
}

.rec-amount-value {
  margin-left: dp(4);
  font-size: dp(12);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.rec-amount-value--green {
  color: #00b42a;
}

.rec-amount-value--orange {
  color: #ff7d00;
}

.rec-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: dp(8);
  color: #a79c92;
  font-size: dp(9);
}

.rec-dispute {
  color: #f53f3f;
}

/* ── 工长操作入口 ── */
.tab-action-row {
  display: flex;
  justify-content: flex-end;
  margin-bottom: dp(10);
}

.tab-action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  height: dp(32);
  padding: 0 dp(14);
  border: 1px solid #f2b99f;
  border-radius: dp(999);
  background: #fff;
  color: #eb5c20;
  font-size: dp(11);
  font-weight: 600;
}

/* ── 登记流水 / 发起对账表单 ── */
.entry-type-row {
  position: relative;
  display: flex;
  padding: dp(4);
  margin: dp(14) 0;
  background: #faf7f3;
  border: 1px solid #eee4dc;
  border-radius: dp(999);
}

/* 两段式胶囊：translateX(100%) 正好到右半段 */
.entry-type-thumb {
  position: absolute;
  top: dp(4);
  bottom: dp(4);
  left: dp(4);
  width: calc((100% - #{dp(8)}) / 2);
  border-radius: dp(999);
  background: #eb5c20;
  box-shadow: 0 dp(2) dp(6) rgba(235, 92, 32, 0.22);
  transition: transform 280ms cubic-bezier(0.22, 1, 0.36, 1);
  will-change: transform;
}

.entry-type {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  height: dp(34);
  border-radius: dp(999);
  background: transparent;
  color: #51463e;
  font-size: dp(12);
  font-weight: 500;
  transition: color 180ms ease;
}

.entry-type--active {
  background: transparent;
  color: #fff;
  font-weight: 600;
  box-shadow: none;
}

/* 支出 / 收入切换后，分类 / 付款节点字段重挂载时淡入 */
.form-field.type-switch-field {
  animation: gc-reveal-up 260ms cubic-bezier(0.22, 1, 0.36, 1);
}

.form-field {
  margin-top: dp(12);
}

.form-label {
  display: block;
  margin-bottom: dp(6);
  color: #51463e;
  font-size: dp(11);
  font-weight: 600;
}

.form-input,
.form-picker {
  width: 100%;
  height: dp(40);
  padding: 0 dp(12);
  background: #fbf8f5;
  border: 1px solid #eee4dc;
  border-radius: dp(9);
  color: #241c17;
  font-size: dp(12);
  box-sizing: border-box;
}

.form-input {
  display: block;
}

.form-picker {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.form-picker--disabled {
  color: #b3a69c;
}

.form-placeholder {
  color: #b3a69c;
}

.form-hint {
  display: block;
  margin-top: dp(5);
  color: #a09388;
  font-size: dp(9);
  line-height: 1.5;
}

.form-note {
  padding: dp(10) dp(12);
  margin-top: dp(12);
  background: #fff7f2;
  border: 1px solid #f7d8c8;
  border-radius: dp(9);
  color: #8a6a58;
  font-size: dp(10);
  line-height: 1.6;
}

.category-row {
  display: flex;
  flex-wrap: wrap;
  gap: dp(8);
}

.category-chip {
  display: flex;
  align-items: center;
  justify-content: center;
  height: dp(30);
  padding: 0 dp(12);
  border: 1px solid #eee4dc;
  border-radius: dp(999);
  background: #fff;
  color: #51463e;
  font-size: dp(11);
}

.category-chip--active {
  border-color: #eb5c20;
  background: #fdebe4;
  color: #c44710;
  font-weight: 600;
}

.receipt-add {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(78);
  height: dp(78);
  background: #fbf8f5;
  border: 1px dashed #e2d3c7;
  border-radius: dp(10);
  flex-direction: column;
}

.receipt-plus {
  color: #eb5c20;
  font-size: dp(22);
  line-height: 1;
}

.receipt-label {
  margin-top: dp(3);
  color: #9a8e84;
  font-size: dp(9);
}

.receipt-preview {
  position: relative;
  width: dp(78);
  height: dp(78);
  overflow: hidden;
  border-radius: dp(10);
}

.receipt-image {
  width: 100%;
  height: 100%;
}

.receipt-remove {
  position: absolute;
  top: 0;
  right: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(20);
  height: dp(20);
  background: rgba(0, 0, 0, 0.55);
  border-radius: 0 0 0 dp(8);
  color: #fff;
  font-size: dp(14);
  line-height: 1;
}

.form-actions {
  display: flex;
  gap: dp(9);
  margin-top: 0;
  padding: dp(10) 0 dp(14);
  border-top: 1px solid #f3efea;
  background: #fff;
}

.form-cancel,
.form-submit {
  display: flex;
  align-items: center;
  justify-content: center;
  height: dp(42);
  border-radius: dp(10);
  font-size: dp(13);
  font-weight: 600;
}

.form-cancel {
  width: 32%;
  border: 1px solid #e8ddd4;
  background: #fff;
  color: #51463e;
}

.form-submit {
  flex: 1;
  background: #eb5c20;
  color: #fff;
}

.form-submit:disabled {
  opacity: 0.62;
}

/* ── 面板通用 ── */
.sheet-mask {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 1200;
  display: flex;
  align-items: flex-end;
  background: rgba(29, 33, 41, 0.5);
  animation: sheet-mask-in 220ms ease-out;
}

.sheet {
  width: 100%;
  max-height: 80vh;
  overflow-y: auto;
  /* tab 页；微信原生 tabBar 已经处理底部安全区 */
  padding: dp(8) dp(16) dp(16);
  border-radius: dp(20) dp(20) 0 0;
  @include glass-sheet;
}

.sheet--reconcile {
  display: flex;
  flex-direction: column;
  max-height: 88vh;
  overflow: hidden;
  padding-bottom: 0;
}

/*
 * 登记流水 / 发起对账是长表单：标题与底部按钮固定，中间字段放进
 * scroll-view。只靠 .sheet 的 overflow-y 在微信里会被蒙层的
 * catchtouchmove 拦住，表现为「内容被按钮盖住、怎么滑都不动」。
 */
.sheet--form {
  display: flex;
  flex-direction: column;
  height: 86vh;
  max-height: 86vh;
  box-sizing: border-box;
  overflow: hidden;
  padding-bottom: 0;
  animation: sheet-rise 480ms cubic-bezier(0.45, 0, 0.25, 1);
}

.form-sheet-scroll {
  flex: 1;
  min-height: 0;
}

.form-sheet-body {
  padding-bottom: dp(2);
}

.sheet-handle {
  width: dp(36);
  height: dp(4);
  margin: 0 auto dp(10);
  border-radius: dp(999);
  background: #e8e1da;
}

.sheet-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding-bottom: dp(12);
  border-bottom: 1px solid #f3efea;
}

.sheet-title {
  display: block;
  color: #2b2119;
  font-size: dp(18);
  font-weight: 700;
}

.sheet-sub {
  display: block;
  margin-top: dp(3);
  color: #8b8179;
  font-size: dp(11);
}

.sheet-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(32);
  height: dp(32);
  flex-shrink: 0;
}

.sheet-close-icon {
  width: dp(18);
  height: dp(18);
}

.sheet-state {
  padding: dp(36) 0;
  color: #8b8179;
  font-size: dp(12);
  text-align: center;
}

.sheet-note {
  margin-top: dp(14);
  padding: dp(10);
  border-radius: dp(8);
  background: #faf7f3;
  color: #8b8179;
  font-size: dp(10);
  line-height: 1.7;
}

.sheet-primary {
  width: 100%;
  height: dp(42);
  margin-top: dp(14);
  border: none;
  border-radius: dp(999);
  background: #eb5c20;
  color: #fff;
  font-size: dp(13);
  font-weight: 600;
  line-height: dp(42);
}

.project-options {
  padding-top: dp(10);
}

.project-option {
  display: flex;
  align-items: center;
  padding: dp(12) dp(2);
  border-bottom: 1px solid #f3efea;
}

.project-option:last-child {
  border-bottom: none;
}

.project-option-main {
  flex: 1;
  min-width: 0;
}

.project-option-name {
  display: block;
  overflow: hidden;
  color: #241c17;
  font-size: dp(13);
  font-weight: 600;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.project-option-meta {
  display: block;
  margin-top: dp(3);
  overflow: hidden;
  color: #8b8179;
  font-size: dp(10);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.project-option-current {
  margin-left: dp(8);
  padding: dp(2) dp(7);
  border-radius: dp(999);
  background: #fdebe4;
  color: #eb5c20;
  font-size: dp(10);
  white-space: nowrap;
}

.project-option-chevron {
  width: dp(13);
  height: dp(13);
  margin-left: dp(8);
  flex-shrink: 0;
}

/* ── 详情列表 ── */
.detail-rows {
  padding-top: dp(8);
}

.detail-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: dp(11) 0;
  border-bottom: 1px solid #f8f4ef;
}

.detail-row:last-child {
  border-bottom: none;
}

.detail-label {
  width: dp(72);
  color: #8b8179;
  font-size: dp(11);
  flex-shrink: 0;
}

.detail-value {
  flex: 1;
  color: #241c17;
  font-size: dp(12);
  text-align: right;
  word-break: break-all;
}

.detail-value--strong {
  color: #eb5c20;
  font-weight: 700;
}

.node-sheet-list {
  padding-top: dp(6);
}

.node-sheet-row {
  display: flex;
  align-items: center;
  padding: dp(12) 0;
  border-bottom: 1px solid #f8f4ef;
}

.node-sheet-row:last-child {
  border-bottom: none;
}

.node-sheet-main {
  flex: 1;
  min-width: 0;
}

.node-sheet-title {
  display: flex;
  align-items: center;
}

.node-sheet-name {
  color: #241c17;
  font-size: dp(12);
  font-weight: 600;
}

.node-sheet-badge {
  margin-left: dp(6);
  padding: dp(1) dp(5);
  border-radius: dp(3);
  font-size: dp(9);
}

.node-sheet-badge--done {
  background: #e8ffea;
  color: #00b42a;
}

.node-sheet-badge--active {
  background: #fff0e0;
  color: #ff7d00;
}

.node-sheet-badge--unlocked {
  background: #fdebe4;
  color: #eb5c20;
}

.node-sheet-badge--pending {
  background: #f3efea;
  color: #8b8179;
}

.node-sheet-meta {
  display: block;
  margin-top: dp(4);
  color: #8b8179;
  font-size: dp(10);
  line-height: 1.5;
}

/* ── 对账详情 ── */
.rec-scroll {
  flex: 1;
  min-height: 0;
  max-height: 62vh;
}

.rec-summary {
  display: flex;
  margin-top: dp(12);
  padding: dp(12);
  @include glass-surface(dp(10), 14px);
  background: linear-gradient(
    135deg,
    rgba(255, 255, 255, 0.84) 0%,
    rgba(250, 247, 243, 0.62) 100%
  );
}

.rec-summary-item {
  flex: 1;
}

.rec-summary-item + .rec-summary-item {
  padding-left: dp(12);
  border-left: 1px solid #e8e1da;
}

.rec-summary-label {
  display: block;
  color: #8b8179;
  font-size: dp(10);
}

.rec-summary-value {
  display: block;
  margin-top: dp(3);
  font-size: dp(14);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.rec-summary-value--green {
  color: #00b42a;
}

.rec-summary-value--orange {
  color: #ff7d00;
}

.rec-remark {
  margin-top: dp(10);
  padding: dp(9) dp(10);
  border-radius: dp(8);
  background: #fff7e8;
  color: #a85400;
  font-size: dp(10);
  line-height: 1.6;
}

.rec-detail-list {
  margin-top: dp(14);
}

.rec-detail-heading {
  display: block;
  color: #241c17;
  font-size: dp(12);
  font-weight: 600;
}

.rec-detail-row {
  padding: dp(11) 0;
  border-bottom: 1px solid #f8f4ef;
}

.rec-detail-row:last-child {
  border-bottom: none;
}

.rec-detail-top {
  display: flex;
  align-items: center;
}

.rec-detail-date {
  color: #8b8179;
  font-size: dp(10);
  font-variant-numeric: tabular-nums;
}

.rec-detail-type {
  margin-left: dp(6);
  padding: dp(1) dp(5);
  border-radius: dp(3);
  font-size: dp(9);
}

.rec-detail-type--income {
  background: #e8ffea;
  color: #00b42a;
}

.rec-detail-type--expense {
  background: #fff0e0;
  color: #ff7d00;
}

.rec-detail-amount {
  margin-left: auto;
  font-size: dp(12);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.rec-detail-amount--income {
  color: #00b42a;
}

.rec-detail-amount--expense {
  color: #ff7d00;
}

.rec-detail-remark {
  display: block;
  margin-top: dp(4);
  color: #51463e;
  font-size: dp(10);
  line-height: 1.5;
}

.dispute-entry {
  display: inline-block;
  margin-top: dp(6);
  color: #f53f3f;
  font-size: dp(10);
  text-decoration: underline;
}

.dispute-note {
  display: flex;
  align-items: flex-start;
  margin-top: dp(6);
  padding: dp(7) dp(8);
  border-radius: dp(6);
  background: #fff1f0;
}

.dispute-note-label {
  margin-right: dp(5);
  color: #f53f3f;
  font-size: dp(9);
  font-weight: 600;
  flex-shrink: 0;
}

.dispute-note-text {
  color: #b22a26;
  font-size: dp(10);
  line-height: 1.5;
}

.dispute-box {
  margin-top: dp(8);
  padding: dp(9);
  border-radius: dp(8);
  background: #faf7f3;
}

.dispute-input {
  width: 100%;
  height: dp(64);
  padding: dp(8);
  border: 1px solid #e8e1da;
  border-radius: dp(6);
  background: #fff;
  color: #241c17;
  font-size: dp(11);
  line-height: 1.5;
  box-sizing: border-box;
}

.dispute-placeholder {
  color: #cfc6bd;
}

.dispute-actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  margin-top: dp(7);
  gap: dp(8);
}

.dispute-cancel {
  padding: dp(5) dp(10);
  color: #8b8179;
  font-size: dp(11);
}

.dispute-submit {
  padding: dp(5) dp(12);
  border-radius: dp(6);
  background: #f53f3f;
  color: #fff;
  font-size: dp(11);
  font-weight: 500;
}

.dispute-submit--disabled {
  opacity: 0.5;
}

.rec-pdf {
  display: flex;
  align-items: center;
  margin-top: dp(14);
  padding: dp(11) dp(12);
  border: 1px solid #e8e1da;
  border-radius: dp(8);
  color: #eb5c20;
  font-size: dp(12);
}

.rec-pdf-icon {
  width: dp(15);
  height: dp(15);
  margin-right: dp(6);
}

.rec-pdf-chevron {
  width: dp(12);
  height: dp(12);
  margin-left: auto;
}

.rec-confirmed-note {
  margin-top: dp(12);
  color: #00b42a;
  font-size: dp(10);
  line-height: 1.6;
}

.rec-actions {
  /* tab 页的底部安全区由微信原生 tabBar 处理 */
  padding: dp(12) dp(16) dp(14);
  border-top: 1px solid #f3efea;
  background: #fff;
}

.rec-action-note {
  padding: dp(8) 0;
  color: #8b8179;
  font-size: dp(11);
  line-height: 1.6;
  text-align: center;
}

.rec-action-note--warn {
  color: #ff7d00;
}

@media (prefers-reduced-motion: reduce) {
  .sheet-mask,
  .sheet--form {
    animation: none;
  }
}
</style>
