<template>
  <view class="page">
    <!-- 自定义导航：设计稿的 iOS 状态栏与微信胶囊是手机壳示意，真机不重复绘制 -->
    <view class="nav" :style="{ paddingTop: `${safeTop + 6}px` }">
      <view class="nav-left">
        <view class="nav-back" @tap="goBack">
          <image class="nav-back-icon" src="/static/images/icon-back.png" mode="aspectFit" />
        </view>
        <text class="nav-title">{{ detail ? detail.name : '项目详情' }}</text>
      </view>
      <view class="nav-more" @tap="openMore">
        <image class="nav-more-icon" src="/static/images/icon-more.png" mode="aspectFit" />
      </view>
    </view>

    <view v-if="loading && !detail" class="state-block">
      <gc-loading text="正在加载项目…" />
    </view>

    <view v-else-if="loadError" class="state-block">
      <image class="state-icon" src="/static/images/icon-acceptance-empty.png" mode="aspectFit" />
      <text class="state-title">项目不可用</text>
      <text class="state-text">{{ loadError }}</text>
      <button class="state-btn" @tap="goBack">返回项目列表</button>
    </view>

    <template v-else-if="detail">
      <view class="content gc-stagger">
        <!-- 一次性订阅：点击后由微信拉起授权弹窗，不能自动调用 -->
        <gc-subscribe-tip
          :types="subscribeTypes"
          :tenant-id="subscribeTenantId || undefined"
          title="开启项目通知"
          description="验收、付款与评论提醒可推送到微信，站内消息不受影响"
        />

        <!-- 项目概览 -->
        <view class="card overview-card">
          <view class="overview-top">
            <image class="overview-cover" :src="coverUrl" mode="aspectFill" />
            <view class="overview-main">
              <view class="overview-badges">
                <text class="status-badge" :class="statusClass">{{ detail.statusLabel }}</text>
                <text class="role-badge">我是{{ detail.myRoleLabel }}</text>
              </view>

              <view class="overview-progress-row">
                <text class="overview-percent">{{ projectPercent }}%</text>
                <view class="overview-track">
                  <view class="overview-fill" :style="{ width: `${projectPercent}%` }" />
                </view>
              </view>

              <view class="overview-address-row">
                <view class="overview-address" @tap="navigateToProject">
                  <image class="overview-location" src="/static/images/icon-location-accent.png" mode="aspectFit" />
                  <text class="overview-address-text">{{ detail.address || '未填写地址' }}</text>
                </view>
                <view class="overview-actions">
                  <view v-if="canCheckin" class="nav-pill nav-pill--checkin" @tap="goCheckin">
                    <image
                      class="nav-pill-icon nav-pill-icon--plain"
                      src="/static/images/icon-checklist-green.png"
                      mode="aspectFit"
                    />
                    <text>签到</text>
                  </view>
                  <view class="nav-pill" @tap="navigateToProject">
                    <image class="nav-pill-icon" src="/static/images/icon-navigation-accent.png" mode="aspectFit" />
                    <text>导航</text>
                  </view>
                </view>
              </view>

            </view>
          </view>

          <!-- 当前阶段与日期放到封面下方通栏：封面保持 1:1 后右侧信息列会变矮，
               继续放在右侧会在封面下方留下空白 -->
          <view class="overview-footer">
            <text class="overview-stage">当前阶段：{{ currentStageName }}</text>
            <view class="overview-dates">
              <text class="overview-date-text">{{ startLabel }} 开工 · {{ planEndLabel }} 计划完工</text>
              <text v-if="overdueDays > 0" class="overview-overdue">延期 {{ overdueDays }} 天 ✕</text>
            </view>
          </view>
        </view>

        <!-- 项目竣工总报告：完工 / 归档后对业主、工长开放 -->
        <view v-if="showCompletionReport" class="card completion-card">
          <view class="section-head">
            <view class="task-head-left">
              <view class="completion-icon">
                <image
                  class="completion-icon-img"
                  src="/static/images/icon-document-amber.png"
                  mode="aspectFit"
                />
              </view>
              <text class="section-title">项目竣工总报告</text>
            </view>
            <text class="completion-state" :class="completionStateClass">
              {{ completionStateText }}
            </text>
          </view>
          <text class="completion-desc">
            汇总各阶段验收、签名记录与账目，可作为项目竣工归档材料下载。
          </text>
          <text v-if="completionReport && completionReport.error" class="completion-error">
            {{ completionReport.error }}
          </text>
          <button
            class="completion-btn"
            :disabled="completionLoading || completionStatus === 'pending'"
            @tap="openCompletionReport(false)"
          >
            {{ completionButtonText }}
          </button>
          <text
            v-if="completionStatus === 'success'"
            class="completion-refresh"
            @tap="openCompletionReport(true)"
          >
            项目数据有更新？重新生成
          </text>
        </view>

        <!-- 待我处理 -->
        <view v-if="pendingCount > 0" class="card tasks-card">
          <view class="section-head">
            <view class="task-head-left">
              <view class="task-alert">!</view>
              <text class="section-title">待我处理 ({{ pendingCount }})</text>
            </view>
            <view class="link" @tap="showAllTasks">
              查看全部
              <image class="link-chevron" src="/static/images/icon-chevron-right.png" mode="aspectFit" />
            </view>
          </view>

          <view class="task-list">
            <!-- 验收待办 -->
            <view
              v-for="task in pendingAcceptances"
              :key="`acceptance-${task.id}`"
              class="task-card task-card--acceptance"
            >
              <view class="task-top">
                <view class="task-doc-icon">
                  <image class="task-doc-image" src="/static/images/icon-document-amber.png" mode="aspectFit" />
                </view>
                <view class="task-main">
                  <text class="task-title">{{ task.stageName || task.itemName || '当前阶段' }}验收{{ taskActionSuffix(task) }}</text>
                  <view class="task-meta">
                    <image class="task-meta-icon" src="/static/images/icon-clock.png" mode="aspectFit" />
                    <text>已等待 {{ waitingText(task.stepEnteredAt) }}</text>
                  </view>
                </view>
                <view class="task-primary" @tap="goAcceptance(task)">{{ taskActionLabel(task) }}</view>
              </view>
              <text class="task-note">{{ acceptanceNote(task) }}</text>
            </view>

            <!-- 阶段结算待办 -->
            <view
              v-for="item in pendingSettlements"
              :key="`settlement-${item.id}`"
              class="task-card task-card--settlement"
            >
              <view class="task-top">
                <view class="task-doc-icon">
                  <image class="task-doc-image" src="/static/images/icon-document-amber.png" mode="aspectFit" />
                </view>
                <view class="task-main">
                  <text class="task-title">{{ item.stageName }}阶段结算{{ item.canConfirm ? '待确认' : '待提交' }}</text>
                  <view class="task-meta">
                    <text>{{ item.statusLabel }} · 应收 ¥ {{ formatMoney(item.receivableAmount) }}</text>
                  </view>
                </view>
                <view class="task-primary" @tap="goStageSettlement(item)">
                  {{ item.canConfirm ? '去确认' : '去提交' }}
                </view>
              </view>
              <text class="task-note">
                {{
                  item.canConfirm
                    ? '核对结算金额与流水；确认无异议后本阶段结清，下一阶段解锁。'
                    : item.status === 'disputed'
                      ? '主业主已提出异议，请核对后重新提交。'
                      : '系统已生成本阶段结算单，请核对后提交主业主。'
                }}
              </text>
            </view>

            <!-- 付款待办 -->
            <view
              v-for="node in pendingPayments"
              :key="`payment-${node.id}`"
              class="task-card task-card--payment"
            >
              <view class="task-top">
                <view class="task-yen-icon">¥</view>
                <view class="task-main">
                  <view class="payment-title-line">
                    <text class="task-title">{{ node.name }}</text>
                    <text class="task-amount">¥ {{ formatMoney(node.amount) }}</text>
                    <text class="task-badge">待确认</text>
                  </view>
                </view>
                <view class="task-actions">
                  <view class="task-primary" @tap="confirmNode(node)">确认已支付</view>
                  <view class="task-ghost" @tap="dismissNode(node)">暂不确认</view>
                </view>
              </view>
              <view class="task-meta task-meta--payment">
                <image class="task-meta-icon" src="/static/images/icon-clock.png" mode="aspectFit" />
                <text>工长已登记收到 ¥ {{ formatMoney(node.amount) }} 线下转账</text>
              </view>
              <text class="task-note task-note--payment">请确认您是否已经支付。系统内不发生任何资金划转。</text>
            </view>
          </view>
        </view>

        <!-- 阶段进度 -->
        <view class="card stages-card">
          <view class="section-head">
            <text class="section-title">阶段进度</text>
            <text class="stage-count">共 {{ stageList.length }} 个阶段 · 上下滑动</text>
          </view>

          <scroll-view v-if="stageList.length" class="stage-scroll" scroll-y :show-scrollbar="true">
            <view class="stage-timeline">
              <view class="stage-line" />
              <view v-for="stage in stageList" :key="stage.id" class="stage-item">
              <view class="stage-row" @tap="toggleStage(stage)">
                <view class="stage-node" :class="`stage-node--${stage.visual.node}`">
                  <image
                    v-if="stage.visual.node === 'done'"
                    class="stage-node-icon"
                    src="/static/images/icon-stage-done.png"
                    mode="aspectFit"
                  />
                  <view v-else-if="stage.visual.node === 'active'" class="stage-node-dot" />
                  <image
                    v-else-if="stage.visual.node === 'locked'"
                    class="stage-node-icon"
                    src="/static/images/icon-lock-gray.png"
                    mode="aspectFit"
                  />
                  <view v-else-if="stage.visual.node === 'warning'" class="stage-node-warning">!</view>
                  <view v-else class="stage-node-dot stage-node-dot--pending" />
                </view>

                <view class="stage-body">
                  <view class="stage-title-row">
                    <text class="stage-name">{{ stage.name }}</text>
                    <text class="stage-badge" :class="`stage-badge--${stage.visual.badgeKind}`">
                      {{ stage.visual.badge }}
                    </text>
                  </view>
                  <text class="stage-dates">{{ stage.visual.range }}</text>
                </view>

                <view class="stage-right">
                  <text class="stage-percent" :class="{ 'stage-percent--active': stage.visual.node === 'active' }">
                    {{ percent(stage.progress) }}%
                  </text>
                  <image
                    class="stage-chevron"
                    :class="{ 'stage-chevron--up': expandedStageId === stage.id }"
                    src="/static/images/icon-chevron-right.png"
                    mode="aspectFit"
                  />
                </view>
              </view>

              <!-- 展开的工序 -->
              <view v-if="expandedStageId === stage.id && stage.items.length" class="stage-items">
                <view v-for="item in stage.items" :key="item.id" class="stage-item-row">
                  <text class="stage-item-name">{{ item.name }}</text>
                  <text class="stage-item-percent">{{ percent(item.progress) }}%</text>
                  <view class="stage-item-track">
                    <view class="stage-item-fill" :style="{ width: `${percent(item.progress)}%` }" />
                  </view>
                  <view class="stage-history" @tap.stop="openHistory(stage, item)">
                    历史
                    <image class="stage-history-chevron" src="/static/images/icon-chevron-right.png" mode="aspectFit" />
                  </view>
                </view>
              </view>

              <!-- 锁定原因 -->
              <view v-if="stage.gateStatus === 'locked'" class="lock-note">
                <view class="lock-note-left">
                  <image class="lock-note-icon" src="/static/images/icon-lock-gray.png" mode="aspectFit" />
                  <text>{{ stage.visual.lockText }}</text>
                </view>
                <image class="lock-note-chevron" src="/static/images/icon-chevron-right.png" mode="aspectFit" />
              </view>

              <!-- 已验收阶段：阶段结算是解锁下一阶段的唯一入口 -->
              <view
                v-if="canOpenStageSettlement(stage)"
                class="lock-note settlement-link"
                @tap.stop="goStageSettlementForStage(stage)"
              >
                <view class="lock-note-left">
                  <image class="lock-note-icon" src="/static/images/icon-document-amber.png" mode="aspectFit" />
                  <text>{{ stageSettlementLabel(stage) }}</text>
                </view>
                <image class="lock-note-chevron" src="/static/images/icon-chevron-right.png" mode="aspectFit" />
              </view>
            </view>
            </view>
          </scroll-view>
          <view v-else class="empty-text">暂无阶段数据</view>
        </view>

        <!-- 工程动态 -->
        <view class="card feed-card">
          <view class="section-head">
            <view class="feed-head-left">
              <text class="section-title">工程动态</text>
              <text class="feed-recent">最近汇报：{{ latestReportTime }}</text>
            </view>
            <view class="feed-head-actions">
              <view v-if="canReportProgress" class="feed-report-btn" @tap="goReport">汇报进度</view>
              <view class="link" @tap="showAllFeed">
                全部
                <image class="link-chevron" src="/static/images/icon-chevron-right.png" mode="aspectFit" />
              </view>
            </view>
          </view>

          <view v-if="latestReport" class="feed-post">
            <view class="feed-author-row">
              <view class="feed-author-left">
                <view class="feed-avatar">
                  <image v-if="authorAvatar" class="feed-avatar-img" :src="authorAvatar" mode="aspectFill" />
                  <text v-else class="feed-avatar-text">{{ authorInitial }}</text>
                </view>
                <view class="feed-author-info">
                  <text class="feed-author-name">{{ authorName }} · {{ authorRoleLabel }}</text>
                  <view class="feed-meta">
                    <text>{{ latestStageName }} · {{ latestItemName }}</text>
                    <text class="feed-delta">{{ deltaText }}</text>
                  </view>
                </view>
              </view>
              <view class="feed-time-wrap">
                <text class="feed-time">{{ latestReportTime }}</text>
                <image class="feed-more" src="/static/images/icon-more.png" mode="aspectFit" />
              </view>
            </view>

            <text v-if="latestReport.content" class="feed-content">{{ latestReport.content }}</text>

            <view
              v-if="feedGridMedia.length"
              class="feed-media-grid"
              :class="`feed-media-grid--${feedGridMedia.length}`"
            >
              <view
                v-for="(media, index) in feedGridMedia"
                :key="`${latestReport.id}-${media.id}`"
                class="feed-media"
                @tap="previewFeedMedia(index)"
              >
                <image class="feed-media-img" :src="media.url" mode="aspectFill" />
                <view v-if="index === 3 && mediaExtra > 0" class="feed-media-more">+{{ mediaExtra }}</view>
              </view>
            </view>

            <view class="feed-footer">
              <view class="feed-comment" @tap="openComments">
                <image class="feed-comment-icon" src="/static/images/icon-comment-gray.png" mode="aspectFit" />
                <text>评论 {{ latestReport.commentCount || 0 }}</text>
              </view>
            </view>
          </view>
          <view v-else class="empty-text">工长还没有提交进度汇报</view>
        </view>

        <!-- 现场考察记录（C-6.18）：所有项目角色都能看到 -->
        <view v-if="visits.length" class="card visit-card">
          <view class="section-head">
            <view class="visit-head-left">
              <text class="section-title">考察记录</text>
              <text class="visit-count">最近 {{ visits.length }} 条</text>
            </view>
            <view class="link" @tap="goVisits">
              全部
              <image class="link-chevron" src="/static/images/icon-chevron-right.png" mode="aspectFit" />
            </view>
          </view>

          <view class="visit-list">
            <view v-for="visit in visits" :key="visit.id" class="visit-row">
              <view class="visit-rail">
                <view class="visit-dot" :class="{ 'visit-dot--abnormal': visit.isAbnormal }" />
                <view class="visit-line" />
              </view>

              <view class="visit-main">
                <view class="visit-line-row">
                  <text class="visit-name">{{ visit.signer.nickname || '项目成员' }}</text>
                  <text v-if="visit.signer.roleLabel" class="visit-role">{{ visit.signer.roleLabel }}</text>
                  <text v-if="visit.isAbnormal" class="visit-abnormal">异常</text>
                </view>
                <text class="visit-meta">
                  {{ visit.checkinAt }} · 距项目 {{ formatVisitDistance(visit.distanceM) }}
                </text>
                <text v-if="visit.remark" class="visit-remark">{{ visit.remark }}</text>
              </view>

              <view v-if="visit.media.length" class="visit-thumbs">
                <image
                  v-for="photo in visit.media.slice(0, 2)"
                  :key="photo.id"
                  class="visit-thumb"
                  :src="resolveMediaUrl(photo.url)"
                  mode="aspectFill"
                  @tap="previewVisitPhoto(visit, photo)"
                />
              </view>
            </view>
          </view>
        </view>

        <!-- 账目概览 -->
        <view v-if="showLedger" class="card finance-card">
          <view class="section-head">
            <view class="finance-head-left">
              <text class="section-title">账目概览</text>
              <text v-if="pendingPaymentBadge" class="finance-badge">
                {{ pendingPaymentBadge }}
              </text>
            </view>
            <view class="link link--accent" @tap="openLedger">
              查看详情
              <image class="link-chevron" src="/static/images/icon-chevron-right.png" mode="aspectFit" />
            </view>
          </view>

          <view class="finance-grid">
            <view class="finance-tile finance-tile--accent">
              <view class="finance-icon">
                <image class="finance-icon-img" src="/static/images/icon-finance-contract.png" mode="aspectFit" />
              </view>
              <view class="finance-text">
                <text class="finance-label">合同总额</text>
                <text class="finance-value">¥ {{ formatMoney(ledger.contractAmount) }}</text>
              </view>
            </view>
            <view class="finance-tile finance-tile--green">
              <view class="finance-icon">
                <image class="finance-icon-img" src="/static/images/icon-finance-income.png" mode="aspectFit" />
              </view>
              <view class="finance-text">
                <text class="finance-label">已收款</text>
                <text class="finance-value">¥ {{ formatMoney(ledger.totalIncome) }}</text>
              </view>
            </view>
            <view class="finance-tile finance-tile--amber">
              <view class="finance-icon">
                <image class="finance-icon-img" src="/static/images/icon-finance-expense.png" mode="aspectFit" />
              </view>
              <view class="finance-text">
                <text class="finance-label">已支出</text>
                <text class="finance-value">¥ {{ formatMoney(ledger.totalExpense) }}</text>
              </view>
            </view>
            <view class="finance-tile finance-tile--sand">
              <view class="finance-icon">
                <image class="finance-icon-img" src="/static/images/icon-finance-balance.png" mode="aspectFit" />
              </view>
              <view class="finance-text">
                <text class="finance-label">当前余额</text>
                <text class="finance-value">¥ {{ formatMoney(ledger.balance) }}</text>
              </view>
            </view>
          </view>

          <view v-if="nextNode" class="next-node" @tap="openLedger">
            <view class="next-node-left">
              <view class="next-node-yen">¥</view>
              <text class="next-node-text">
                下一节点：{{ nextNode.name }}
                <text class="next-node-amount">¥ {{ formatMoney(nextNode.amount) }}</text>
              </text>
            </view>
            <image class="next-node-chevron" src="/static/images/icon-chevron-right.png" mode="aspectFit" />
          </view>
        </view>

        <!-- 门锁密码：业主管理；工长 / 监理可查看明文 -->
        <view
          v-if="isDoorViewer"
          class="card door-card"
          :class="{ 'door-card--disabled': isArchived }"
          @tap="openDoorCode"
        >
          <view class="door-card-left">
            <view class="door-icon-wrap">
              <image class="door-icon" src="/static/images/icon-door-shield.png" mode="aspectFit" />
            </view>
            <view class="door-card-text">
              <text class="section-title">门锁密码</text>
              <text class="door-sub">{{ doorSubtitle }}</text>
            </view>
          </view>
          <view class="door-card-action">
            <text>{{ isArchived ? '不可查看' : isOwner ? '管理' : '查看' }}</text>
            <image class="door-chevron" src="/static/images/icon-chevron-right.png" mode="aspectFit" />
          </view>
        </view>

        <!-- 联系与导航 -->
        <view class="card contacts-card">
          <text class="section-title">联系与导航</text>

          <view v-if="isOwner && contacts.length" class="contact-list">
            <view v-for="contact in contacts" :key="`${contact.role}-${contact.phone}`" class="contact-row">
              <view class="contact-left">
                <view class="contact-icon">
                  <image class="contact-icon-img" src="/static/images/icon-contact-phone.png" mode="aspectFit" />
                </view>
                <view class="contact-text">
                  <text class="contact-label">
                    {{ contact.role === 'foreman' ? (contact.isPrimaryForeman ? '主工长' : '工长') : '监理' }}
                  </text>
                  <text class="contact-name">{{ contact.name }}</text>
                  <text class="contact-phone">{{ formatPhone(contact.phone) }}</text>
                </view>
              </view>
              <view class="contact-call" @tap="callContact(contact.phone)">
                <image class="contact-call-icon" src="/static/images/icon-phone-accent.png" mode="aspectFit" />
                <text>拨打电话</text>
              </view>
            </view>
          </view>

          <view class="contact-row contact-row--address">
            <view class="contact-left">
              <view class="contact-icon">
                <image class="contact-icon-img" src="/static/images/icon-contact-address.png" mode="aspectFit" />
              </view>
              <view class="contact-text">
                <text class="contact-label">项目地址</text>
                <text class="contact-address">{{ detail.address || '未填写地址' }}</text>
              </view>
            </view>
            <view class="contact-call" @tap="navigateToProject">
              <image class="contact-call-icon" src="/static/images/icon-navigation-accent.png" mode="aspectFit" />
              <text>导航</text>
            </view>
          </view>
        </view>
      </view>
    </template>

    <!-- 工序历史面板 -->
    <view v-if="historyOpen" class="sheet-mask" @touchmove.stop.prevent="sheetSwipe.onMaskTouchMove" @tap="closeHistory">
      <view class="sheet" :style="sheetSwipeStyle" @tap.stop>
        <view class="sheet-head" @touchstart="sheetSwipe.onTouchStart" @touchmove.stop.prevent="sheetSwipe.onTouchMove" @touchend="sheetSwipe.onTouchEnd">
          <view>
            <text class="sheet-title">{{ historyItemName }}</text>
            <text class="sheet-sub">完成度变更历史</text>
          </view>
          <view class="sheet-close" @tap="closeHistory">
            <image class="sheet-close-icon" src="/static/images/icon-close.png" mode="aspectFit" />
          </view>
        </view>

        <view v-if="historyLoading" class="sheet-state"><gc-loading inline text="加载中" /></view>
        <view v-else-if="!historyList.length" class="sheet-state">暂无变更记录</view>
        <view v-else class="history-list">
          <view v-for="row in historyList" :key="row.id" class="history-row">
            <view class="history-dot" />
            <view class="history-main">
              <view class="history-change">
                <text class="history-from">{{ percent(row.fromProgress) }}%</text>
                <text class="history-arrow">→</text>
                <text class="history-to">{{ percent(row.toProgress) }}%</text>
              </view>
              <text class="history-meta">{{ row.operator }} · {{ formatDateTime(row.changedAt) }}</text>
              <text v-if="row.remark" class="history-remark">{{ row.remark }}</text>
            </view>
          </view>
        </view>
      </view>
    </view>

    <!-- 评论面板 -->
    <view v-if="commentsOpen" class="sheet-mask" @touchmove.stop.prevent="sheetSwipe.onMaskTouchMove" @tap="closeComments">
      <view class="sheet sheet--comments" :style="sheetSwipeStyle" @tap.stop>
        <view class="sheet-head" @touchstart="sheetSwipe.onTouchStart" @touchmove.stop.prevent="sheetSwipe.onTouchMove" @touchend="sheetSwipe.onTouchEnd">
          <view>
            <text class="sheet-title">评论</text>
            <text class="sheet-sub">{{ activeReport ? `${activeReport.commentCount || 0} 条评论` : '' }}</text>
          </view>
          <view class="sheet-close" @tap="closeComments">
            <image class="sheet-close-icon" src="/static/images/icon-close.png" mode="aspectFit" />
          </view>
        </view>

        <scroll-view class="comment-scroll" scroll-y>
          <view v-if="commentsLoading" class="sheet-state"><gc-loading inline text="加载中" /></view>
          <view v-else-if="!comments.length" class="sheet-state">还没有评论，来说一句吧</view>
          <view v-else class="comment-list">
            <view v-for="comment in comments" :key="comment.id" class="comment-row">
              <view class="comment-avatar">{{ (comment.author.nickname || '用').slice(0, 1) }}</view>
              <view class="comment-main">
                <view class="comment-head">
                  <text class="comment-name">{{ comment.author.nickname || '项目成员' }}</text>
                  <text class="comment-time">{{ formatDateTime(comment.createdAt) }}</text>
                </view>
                <text class="comment-content">{{ comment.content }}</text>
              </view>
            </view>
          </view>
        </scroll-view>

        <view class="comment-input-row">
          <input
            v-model="commentInput"
            class="comment-input"
            confirm-type="send"
            placeholder="写评论…"
            placeholder-class="comment-placeholder"
            @confirm="submitComment"
          />
          <view
            class="comment-submit"
            :class="{ 'comment-submit--disabled': commentSubmitting || !commentInput.trim() }"
            @tap="submitComment"
          >
            {{ commentSubmitting ? '发送中' : '发送' }}
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onLoad, onShow, onPullDownRefresh } from '@dcloudio/uni-app'
import {
  projectDetail,
  projectStages,
  projectAcceptances,
  projectItemHistory,
  projectReports,
  projectPaymentNodes,
  projectLedgerSummary,
  projectContacts,
  confirmPaymentNode,
  fetchProjectCompletionReport,
  generateProjectCompletionReport,
} from '../../api/project'
import { fetchReportComments, addReportComment } from '../../api/report'
import { fetchProjectVisits } from '../../api/visit'
import { resolveMediaUrl } from '../../api/request'
import { getToken } from '../../store/session'
import {
  getCurrentProject,
  setCurrentProject,
  clearCurrentProject,
} from '../../store/projectContext'
import { useSwipeClose } from '../../composables/useSwipeClose'

// 底部弹窗下滑关闭：绑定把手 / 标题区，不干扰表单滚动
const sheetSwipe = useSwipeClose(() => closeActiveSheet())
const sheetSwipeStyle = sheetSwipe.style

const STATUS_CLASSES = {
  pending: 'status-badge--pending',
  building: 'status-badge--building',
  finished: 'status-badge--finished',
  archived: 'status-badge--archived',
}

const id = ref(null)
const safeTop = ref(12)

// 订阅授权按角色给：业主关心验收 / 付款 / 进度，工长关心验收结果与评论
const subscribeTypes = computed(() => {
  const role = getCurrentProject()?.role
  if (role === 'owner') return ['acceptance', 'payment', 'progress']
  if (role === 'foreman') return ['acceptance', 'comment']
  return ['acceptance']
})

const subscribeTenantId = computed(() => {
  const current = getCurrentProject()
  return current && current.tenantId ? Number(current.tenantId) : null
})
const loading = ref(true)
const loadError = ref('')
const detail = ref(null)
const stageListRaw = ref([])
const acceptanceData = ref({ groups: [] })
const reports = ref([])
const paymentNodes = ref([])
const ledger = ref(null)
const contacts = ref([])
const visits = ref([])
const completionReport = ref(null)
const completionLoading = ref(false)
const dismissedPaymentIds = ref([])
const expandedStageId = ref(null)

const historyOpen = ref(false)
const historyLoading = ref(false)
const historyItemName = ref('')
const historyList = ref([])

const commentsOpen = ref(false)
const commentsLoading = ref(false)
const comments = ref([])
const commentInput = ref('')
const commentSubmitting = ref(false)
const activeReport = ref(null)

let loadedOnce = false

const isOwner = computed(() => detail.value?.myRole === 'owner')
// 临时业主与业主共享查看能力，但验收/付款/对账只有主业主能操作
const isPrimaryOwner = computed(() => Boolean(detail.value && detail.value.isPrimaryOwner))
const isForeman = computed(() => detail.value?.myRole === 'foreman')
const isSupervisor = computed(() => detail.value?.myRole === 'supervisor')

// 竣工总报告包含账务汇总：只对业主 / 工长展示，监理在系统里也看不到项目账目
const showCompletionReport = computed(
  () =>
    (isOwner.value || isForeman.value) &&
    ['finished', 'archived'].includes(detail.value?.status)
)

const completionStatus = computed(() => completionReport.value?.status || 'none')

const completionStateText = computed(() => {
  if (completionStatus.value === 'success') return '已生成'
  if (completionStatus.value === 'pending') return '生成中'
  if (completionStatus.value === 'failed') return '生成失败'
  return '待生成'
})

const completionStateClass = computed(() => ({
  'completion-state--success': completionStatus.value === 'success',
  'completion-state--danger': completionStatus.value === 'failed',
}))

const completionButtonText = computed(() => {
  if (completionLoading.value || completionStatus.value === 'pending') return '生成中…'
  if (completionStatus.value === 'success') return '查看总报告'
  if (completionStatus.value === 'failed') return '重新生成'
  return '生成总报告'
})

// 门锁密码对三种项目角色都可见；后台管理员不属于项目成员，不会进到这里
const isDoorViewer = computed(() => isOwner.value || isForeman.value || isSupervisor.value)
const isArchived = computed(() => detail.value?.status === 'archived')
// 只有工长 / 监理能签到；没有项目坐标时后端也无法计算偏差，入口直接隐藏
const canCheckin = computed(
  () =>
    Boolean(detail.value) &&
    (isForeman.value || isSupervisor.value) &&
    !isArchived.value &&
    Boolean(detail.value.hasCoordinates)
)
// 进度汇报只有工长能提交；至少要有一个 canReport 的阶段才显示入口
const canReportProgress = computed(
  () =>
    isForeman.value &&
    !isArchived.value &&
    stageListRaw.value.some((stage) => stage.canReport)
)
const doorSubtitle = computed(() => {
  if (isArchived.value) return '项目已归档，门锁密码不可查看'
  if (isOwner.value) return '管理门锁密码，工长与监理可直接查看'
  return '查看业主设置的门锁密码'
})

const acceptanceTodo = computed(() => {
  const groups = acceptanceData.value?.groups || []
  const todo = groups.find((group) => group.key === 'todo')
  return (todo && todo.items) || []
})

const pendingAcceptances = computed(() =>
  acceptanceTodo.value.filter(
    (item) => item.isMine && (item.status === 'pending_owner' || item.status === 'pending_supervisor')
  )
)

const pendingPayments = computed(() => {
  // 临时业主可以看账目，但付款确认只属于主业主；这里不给他生成可操作的待办
  if (!isPrimaryOwner.value) return []
  return paymentNodes.value.filter(
    (node) => node.status === 'paid' && !dismissedPaymentIds.value.includes(node.id)
  )
})

// 阶段结算待办：后端已按当前访问者算好 canSubmit / canConfirm，
// 前端不按角色再猜一遍（临时业主与主业主的能力不同）。
const pendingSettlements = computed(() =>
  (detail.value?.stageSettlements || []).filter((item) => item.canSubmit || item.canConfirm)
)

const stageSettlementByStage = computed(() => {
  const map = new Map()
  for (const item of detail.value?.stageSettlements || []) {
    map.set(Number(item.stageId), item)
  }
  return map
})

const pendingCount = computed(
  () => pendingAcceptances.value.length + pendingPayments.value.length + pendingSettlements.value.length
)

const pendingAcceptanceByStage = computed(() => {
  const map = new Map()
  for (const item of pendingAcceptances.value) {
    if (item.stageId) map.set(Number(item.stageId), item)
  }
  return map
})

const currentStage = computed(() => {
  if (!stageListRaw.value.length) return null
  const byId = stageListRaw.value.find(
    (stage) => Number(stage.id) === Number(detail.value?.currentStageId)
  )
  if (byId) return byId
  return (
    stageListRaw.value.find((stage) => stage.gateStatus !== 'settled') ||
    stageListRaw.value[stageListRaw.value.length - 1]
  )
})

const currentStageName = computed(
  () => currentStage.value?.name || detail.value?.currentStageName || '暂无阶段'
)

const stageList = computed(() => stageListRaw.value.map(withVisual))

const projectPercent = computed(() => percent(detail.value?.progress))

const coverUrl = computed(() => {
  // 管理员上传的封面优先；没有封面时回落到内置实景占位图
  if (detail.value?.coverUrl) return resolveMediaUrl(detail.value.coverUrl)
  const index = (Math.abs(Number(detail.value?.id) || 0) % 4) + 1
  return `/static/images/project-cover-${index}.jpg`
})

const statusClass = computed(() => STATUS_CLASSES[detail.value?.status] || 'status-badge--pending')

const startLabel = computed(() => monthDay(detail.value?.startDate) || '未设置')
const planEndLabel = computed(() => monthDay(detail.value?.planEndDate) || '未设置')
const overdueDays = computed(() => {
  if (!detail.value?.planEndDate) return 0
  if (detail.value.status === 'archived') return 0
  // 已完工项目以实际完工日比较，判定结果冻结；在建项目才与今天比较
  const reference =
    detail.value.status === 'finished' && detail.value.actualEndDate
      ? detail.value.actualEndDate
      : todayDate()
  const days = dateDiff(detail.value.planEndDate, reference)
  return Number.isFinite(days) && days > 0 ? days : 0
})

const latestReport = computed(() => reports.value[0] || null)
const latestReportTime = computed(() => timeAgo(latestReport.value?.createdAt))
const authorName = computed(() => latestReport.value?.author?.nickname || '项目成员')
const authorRoleLabel = computed(
  () => latestReport.value?.author?.roleLabel || roleLabel(latestReport.value?.author?.role)
)
const authorAvatar = computed(() => resolveMediaUrl(latestReport.value?.author?.avatar))
const authorInitial = computed(() => (authorName.value || '工').slice(0, 1))
const latestStageName = computed(() => latestReport.value?.stageName || '')
const latestItemName = computed(() => latestReport.value?.itemName || '')
const deltaText = computed(() => {
  const report = latestReport.value
  if (!report) return ''
  const to = percent(report.progress)
  if (report.fromProgress !== null && report.fromProgress !== undefined) {
    return `${percent(report.fromProgress)}% → ${to}%`
  }
  return `进度更新至 ${to}%`
})

const latestMedia = computed(() => {
  const media = (latestReport.value && latestReport.value.media) || []
  return media
    .filter((item) => item.type === 'image')
    .map((item) => ({ ...item, url: resolveMediaUrl(item.url) }))
})
const feedGridMedia = computed(() => latestMedia.value.slice(0, 4))
const mediaExtra = computed(() => Math.max(0, latestMedia.value.length - 4))

const showLedger = computed(() => Boolean(ledger.value) && (isOwner.value || isForeman.value))
const pendingPaymentCount = computed(
  () => paymentNodes.value.filter((node) => node.status === 'paid').length
)
const pendingPaymentBadge = computed(() => {
  if (pendingPaymentCount.value <= 0) return ''
  return isPrimaryOwner.value
    ? `有 ${pendingPaymentCount.value} 笔付款待您确认`
    : `有 ${pendingPaymentCount.value} 笔付款待主业主确认`
})
const nextNode = computed(() => {
  // 节点按 seq 返回；「下一节点」取第一个尚未确认的节点。
  // 不优先挑 unlocked：已付款待确认的节点同样需要业主处理，跳过它会让
  // 「待我处理」和「下一节点」指向两个不同的东西。
  return (paymentNodes.value || []).find((node) => node.status !== 'confirmed') || null
})

function roleLabel(role) {
  return { foreman: '工长', supervisor: '监理', owner: '业主' }[role] || '项目成员'
}

function canOpenStageSettlement(stage) {
  if (!(isOwner.value || isForeman.value)) return false
  return stage.gateStatus === 'accepted' || stage.gateStatus === 'disputed'
}

function stageSettlementLabel(stage) {
  const settlement = stageSettlementByStage.value.get(Number(stage.id))
  if (!settlement) return '阶段已验收，去完成阶段结算'
  if (settlement.status === 'draft') return '阶段结算待主工长提交'
  if (settlement.status === 'pending') return '阶段结算待主业主确认'
  if (settlement.status === 'disputed') return '阶段结算有异议，去处理'
  return '阶段已结清'
}

function goStageSettlement(item) {
  if (!item) return
  const query = item.id
    ? `id=${item.id}`
    : `projectId=${detail.value?.id || currentProjectId()}&stageId=${item.stageId}`
  uni.navigateTo({
    url: `/pages/settlement/detail?${query}`,
    fail: () => uni.showToast({ title: '阶段结算暂不可用', icon: 'none' }),
  })
}

function goStageSettlementForStage(stage) {
  const settlement = stageSettlementByStage.value.get(Number(stage.id))
  goStageSettlement(
    settlement || {
      stageId: stage.id,
    }
  )
}

function currentProjectId() {
  return detail.value?.id || 0
}

function withVisual(stage) {
  return { ...stage, visual: stageVisual(stage) }
}

function stageVisual(stage) {
  const gate = stage.gateStatus
  const pending = pendingAcceptanceByStage.value.get(Number(stage.id))
  let node = 'pending'
  let badge = '未开始'
  let badgeKind = 'pending'

  if (gate === 'settled') {
    node = 'done'
    badge = '已结清'
    badgeKind = 'done'
  } else if (gate === 'accepted') {
    node = 'done'
    badge = '已验收'
    badgeKind = 'done'
  } else if (gate === 'disputed') {
    node = 'warning'
    badge = '结算有异议'
    badgeKind = 'warning'
  } else if (gate === 'pending_acceptance') {
    node = pending ? 'active' : 'warning'
    badge = pending ? acceptanceBadge(pending) : '待验收'
    badgeKind = pending ? 'warning' : 'warning'
  } else if (gate === 'active') {
    node = 'active'
    badge = '进行中'
    badgeKind = 'active'
  } else if (gate === 'locked') {
    node = 'locked'
    badge = '未解锁'
    badgeKind = 'locked'
  }

  return {
    node,
    badge,
    badgeKind,
    range: stageRange(stage),
    lockText: lockText(stage),
  }
}

function acceptanceBadge(task) {
  if (task.status === 'pending_supervisor') return '待您签字审核'
  return '待您签字'
}

function stageRange(stage) {
  const start = monthDay(stage.planStart)
  const end = monthDay(stage.planEnd)
  if (start && end) return `${start} - ${end}`
  if (start) return `${start} 起`
  return '未设置计划日期'
}

function lockText(stage) {
  const reason = stage.lockedReason || ''
  if (!reason) return '上一阶段未结清'
  const name = reason.replace(/未结清$/, '')
  return name && name !== reason ? `上一阶段「${name}」未结清` : reason
}

function taskActionLabel(task) {
  if (task.status === 'pending_supervisor') return '去签名审核'
  return '去签名'
}

function taskActionSuffix(task) {
  return task.status === 'pending_supervisor' ? '待您签字审核' : '待您签名'
}

function acceptanceNote(task) {
  if (task.status === 'pending_supervisor') {
    return '审核通过时需签名；通过后进入业主确认，驳回会退回工长整改并保留流转记录。'
  }
  return '签字后解锁本阶段付款节点；下一阶段仍需结算后解锁。'
}

function waitingText(value) {
  if (!value) return '—'
  const start = parseDateTime(value)
  if (!start) return '—'
  const minutes = Math.max(0, Math.floor((Date.now() - start.getTime()) / 60000))
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时`
  return `${Math.floor(hours / 24)} 天`
}

function timeAgo(value) {
  if (!value) return '暂无汇报'
  const date = parseDateTime(value)
  if (!date) return '暂无汇报'
  const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000))
  if (minutes < 5) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} 天前`
  return formatDateTime(value).slice(5, 16)
}

function parseDateTime(value) {
  if (!value) return null
  const date = new Date(String(value).replace(' ', 'T'))
  return Number.isNaN(date.getTime()) ? null : date
}

function formatDateTime(value) {
  if (!value) return ''
  const text = String(value)
  return text.length >= 16 ? text.slice(0, 16) : text
}

function todayDate() {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`
}

function parseDate(value) {
  if (!value) return null
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`)
  return Number.isNaN(date.getTime()) ? null : date
}

function dateDiff(from, to) {
  const start = parseDate(from)
  const end = parseDate(to)
  if (!start || !end) return Number.NaN
  return Math.round((end.getTime() - start.getTime()) / 86400000)
}

function monthDay(value) {
  if (!value) return ''
  const text = String(value).slice(0, 10)
  if (text.length < 10) return ''
  return `${text.slice(5, 7)}月${text.slice(8, 10)}日`
}

function percent(value) {
  const number = Number(value) || 0
  return Math.max(0, Math.min(100, Math.round(number)))
}

function formatMoney(value) {
  if (value === null || value === undefined || value === '') return '0'
  const [integer, decimal = ''] = String(value).split('.')
  const formatted = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const fraction = Number(decimal) === 0 ? '' : `.${decimal.padEnd(2, '0').slice(0, 2)}`
  return `${formatted}${fraction}`
}

function formatPhone(phone) {
  if (!phone) return ''
  const text = String(phone)
  if (text.length === 11) return `${text.slice(0, 3)} ${text.slice(3, 7)} ${text.slice(7)}`
  return text
}

async function load(silent = false) {
  if (!id.value) return
  if (!silent) loading.value = true
  loadError.value = ''

  try {
    const [
      project,
      stageData,
      acceptance,
      reportData,
      nodeData,
      ledgerData,
      contactData,
      visitData,
      completionData,
    ] = await Promise.all([
      projectDetail(id.value),
      projectStages(id.value).catch(() => null),
      projectAcceptances(id.value).catch(() => null),
      projectReports(id.value, { page: 1, pageSize: 20 }).catch(() => null),
      projectPaymentNodes(id.value).catch(() => null),
      projectLedgerSummary(id.value).catch(() => null),
      projectContacts(id.value).catch(() => null),
      // 考察记录不是项目详情的主数据；失败时不能把整页拖进错误态
      fetchProjectVisits(id.value, { page: 1, pageSize: 3 }).catch(() => null),
      // 监理没有查看权限；失败不应影响项目详情本身
      fetchProjectCompletionReport(id.value).catch(() => null),
    ])

    detail.value = project
    stageListRaw.value = (stageData && stageData.stages) || project.stages || []
    acceptanceData.value = acceptance || { groups: [] }
    reports.value = (reportData && reportData.list) || []
    paymentNodes.value = (nodeData && nodeData.nodes) || []
    ledger.value = ledgerData || null
    contacts.value = (contactData && contactData.contacts) || []
    visits.value = (visitData && visitData.list) || []
    completionReport.value = completionData || null

    if (!expandedStageId.value) {
      expandedStageId.value = currentStage.value ? currentStage.value.id : null
    }

    const current = getCurrentProject()
    if (!current || Number(current.id) !== Number(project.id)) {
      setCurrentProject({ ...project, myRole: project.myRole })
    }

    loadedOnce = true
  } catch (err) {
    if (err.statusCode === 401) {
      uni.redirectTo({ url: '/pages/login/index' })
      return
    }

    if (err.statusCode === 404) {
      clearCurrentProject()
      loadError.value = '项目不存在，或您已不在该项目中'
      return
    }

    if (detail.value) {
      uni.showToast({ title: err.message || '刷新失败，请稍后重试', icon: 'none' })
    } else {
      loadError.value = err.message || '加载失败，请稍后重试'
    }
  } finally {
    loading.value = false
    uni.stopPullDownRefresh()
  }
}

function goBack() {
  uni.navigateBack({
    fail: () => uni.reLaunch({ url: '/pages/projects/index' }),
  })
}

function openMore() {
  // 用 key 而不是下标：后面再加「现场签到」「考察记录」时，
  // 原来按 tapIndex === 2 判断「考察计划」的写法会静默错位。
  const actions = [
    { key: 'refresh', label: '刷新' },
    { key: 'copy', label: '复制项目地址' },
  ]

  if (isForeman.value || isSupervisor.value) {
    if (canCheckin.value) actions.push({ key: 'checkin', label: '现场签到' })
    actions.push({ key: 'route-plan', label: '考察计划' })
  }
  if (visits.value.length) actions.push({ key: 'visits', label: '考察记录' })
  actions.push({ key: 'back', label: '返回项目列表' })

  uni.showActionSheet({
    itemList: actions.map((action) => action.label),
    success: (res) => {
      const action = actions[res.tapIndex]
      if (!action) return

      if (action.key === 'refresh') load(true)
      else if (action.key === 'copy') copyAddress()
      else if (action.key === 'checkin') goCheckin()
      else if (action.key === 'route-plan') goRoutePlan()
      else if (action.key === 'visits') goVisits()
      else if (action.key === 'back') goBack()
    },
  })
}

function goRoutePlan() {
  uni.navigateTo({ url: '/pages/route-plan/index' })
}

function goCheckin() {
  if (!detail.value) return
  if (!detail.value.hasCoordinates) {
    uni.showToast({ title: '项目尚未设置坐标，请联系管理员补全', icon: 'none' })
    return
  }
  uni.navigateTo({
    url:
      `/pages/visit/checkin?projectId=${detail.value.id}` +
      `&name=${encodeURIComponent(detail.value.name || '')}`,
  })
}

function goVisits() {
  if (!detail.value) return
  uni.navigateTo({
    url: `/pages/visit/timeline?projectId=${detail.value.id}`,
  })
}

function formatVisitDistance(meters) {
  const value = Number(meters)
  if (!Number.isFinite(value)) return '未知'
  if (value < 1000) return `${Math.round(value)} 米`
  return `${(value / 1000).toFixed(1)} 公里`
}

function previewVisitPhoto(visit, photo) {
  const urls = visit.media.map((item) => resolveMediaUrl(item.url))
  uni.previewImage({ urls, current: resolveMediaUrl(photo.url) })
}

function openDoorCode() {
  if (isArchived.value) {
    uni.showToast({ title: '项目已归档，门锁密码不可查看', icon: 'none' })
    return
  }
  if (!detail.value) return

  uni.navigateTo({
    url:
      `/pages/project/door-code?projectId=${detail.value.id}` +
      `&name=${encodeURIComponent(detail.value.name || '')}`,
  })
}

function copyAddress() {
  const address = detail.value?.address || ''
  if (!address) {
    uni.showToast({ title: '暂无项目地址', icon: 'none' })
    return
  }
  uni.setClipboardData({
    data: address,
    success: () => uni.showToast({ title: '地址已复制', icon: 'none' }),
  })
}

function navigateToProject() {
  if (!detail.value?.hasCoordinates) {
    uni.showToast({ title: '项目尚未设置坐标，请联系管理员补全', icon: 'none' })
    return
  }
  uni.openLocation({
    latitude: Number(detail.value.latitude),
    longitude: Number(detail.value.longitude),
    name: detail.value.name,
    address: detail.value.address || '',
  })
}

function goAcceptance(task) {
  if (!task || !task.id) return
  uni.navigateTo({ url: `/pages/acceptance/detail?id=${task.id}` })
}

async function confirmNode(node) {
  if (!node) return
  if (!isPrimaryOwner.value) {
    uni.showToast({ title: '付款确认需由主业主操作', icon: 'none' })
    return
  }
  uni.showModal({
    title: '确认收款',
    content: `确认已向「${node.name}」支付 ¥ ${formatMoney(node.amount)}？系统只记录状态，不进行资金划转。`,
    confirmText: '确认已支付',
    success: async (res) => {
      if (!res.confirm) return
      try {
        await confirmPaymentNode(id.value, node.id)
        uni.showToast({ title: '已确认收款', icon: 'success' })
        await load(true)
      } catch (err) {
        uni.showToast({ title: err.message || '确认失败', icon: 'none' })
      }
    },
  })
}

function dismissNode(node) {
  if (!node) return
  dismissedPaymentIds.value = [...dismissedPaymentIds.value, node.id]
  uni.showToast({ title: '已暂不确认，可稍后处理', icon: 'none' })
}

function showAllTasks() {
  uni.showToast({ title: '本项目的待办已全部展示', icon: 'none' })
}

function showAllFeed() {
  uni.navigateTo({ url: `/pages/project/feed?projectId=${id.value}` })
}

function goReport() {
  if (!detail.value) return
  uni.navigateTo({
    url: `/pages/report/submit?projectId=${detail.value.id}`,
  })
}

function toggleStage(stage) {
  if (!stage) return
  if (stage.gateStatus === 'locked') return
  expandedStageId.value = expandedStageId.value === stage.id ? null : stage.id
}

async function openHistory(stage, item) {
  historyOpen.value = true
  historyItemName.value = item.name || '工序'
  historyList.value = []
  historyLoading.value = true
  try {
    const data = await projectItemHistory(id.value, item.id)
    historyList.value = data.history || []
  } catch (err) {
    uni.showToast({ title: err.message || '历史加载失败', icon: 'none' })
  } finally {
    historyLoading.value = false
  }
}

function closeHistory() {
  historyOpen.value = false
}

function previewFeedMedia(index) {
  const urls = latestMedia.value.map((item) => item.url)
  if (!urls.length) return
  uni.previewImage({ urls, current: urls[index] })
}

async function openComments() {
  if (!latestReport.value) return
  activeReport.value = latestReport.value
  commentsOpen.value = true
  comments.value = []
  commentsLoading.value = true
  try {
    const data = await fetchReportComments(latestReport.value.id)
    comments.value = data.list || []
  } catch (err) {
    uni.showToast({ title: err.message || '评论加载失败', icon: 'none' })
  } finally {
    commentsLoading.value = false
  }
}

function closeComments() {
  if (commentSubmitting.value) return
  commentsOpen.value = false
}

async function submitComment() {
  const content = commentInput.value.trim()
  if (!content || commentSubmitting.value || !activeReport.value) return
  commentSubmitting.value = true
  try {
    await addReportComment(activeReport.value.id, content)
    commentInput.value = ''
    uni.showToast({ title: '评论已发送', icon: 'success' })
    const data = await fetchReportComments(activeReport.value.id)
    comments.value = data.list || []
    // 本地同步计数，避免返回列表后数字还是旧的
    if (latestReport.value) {
      latestReport.value.commentCount = (latestReport.value.commentCount || 0) + 1
      activeReport.value.commentCount = latestReport.value.commentCount
    }
  } catch (err) {
    uni.showToast({ title: err.message || '评论失败', icon: 'none' })
  } finally {
    commentSubmitting.value = false
  }
}

function callContact(phone) {
  if (!phone) return
  uni.makePhoneCall({ phoneNumber: String(phone) })
}

function openLedger() {
  uni.switchTab({ url: '/pages/ledger/index' })
}

/**
 * 打开 / 生成竣工总报告。
 *
 * 已生成 -> 直接打开签名链接；未生成或失败 -> 先 POST 生成，再打开。
 * 生成失败不改变项目状态，页面只展示失败原因，允许再次点击重试。
 */
async function openCompletionReport(refresh = false) {
  if (completionLoading.value || completionStatus.value === 'pending') return

  if (!refresh && completionStatus.value === 'success' && completionReport.value?.signedPath) {
    openPdfPath(completionReport.value.signedPath)
    return
  }

  completionLoading.value = true
  try {
    const data = await generateProjectCompletionReport(id.value, { refresh })
    completionReport.value = data

    if (data.status === 'success' && data.signedPath) {
      openPdfPath(data.signedPath)
    } else if (data.status === 'failed') {
      uni.showToast({ title: data.error || '总报告生成失败', icon: 'none' })
    }
  } catch (err) {
    uni.showToast({ title: err.message || '总报告生成失败', icon: 'none' })
  } finally {
    completionLoading.value = false
  }
}

function openPdfPath(path) {
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
      uni.openDocument({ filePath: res.tempFilePath, fileType: 'pdf', showMenu: true })
    },
    fail: () => {
      uni.hideLoading()
      uni.showToast({ title: '总报告下载失败', icon: 'none' })
    },
  })
  // #endif
}

onLoad((options) => {
  const info = uni.getSystemInfoSync()
  safeTop.value = info.statusBarHeight || 12

  if (!getToken()) {
    uni.redirectTo({ url: '/pages/login/index' })
    return
  }

  const current = getCurrentProject()
  id.value = Number(options?.id) || current?.id || null
  if (!id.value) {
    uni.redirectTo({ url: '/pages/projects/index' })
    return
  }

  load()
})

onShow(() => {
  if (loadedOnce && !loading.value) load(true)
})

onPullDownRefresh(() => {
  load(true)
})
function closeActiveSheet() {
  if (historyOpen.value) closeHistory()
  else if (commentsOpen.value) closeComments()
}
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  padding-bottom: calc(#{dp(28)} + env(safe-area-inset-bottom));
  background: #faf7f4;
}

/* ── 导航 ── */
.nav {
  position: sticky;
  top: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-right: dp(14);
  padding-bottom: dp(8);
  padding-left: dp(8);
  /* 吸顶导航必须基本不透明：内容滚到下面时半透明底会把卡片顶部透出来，
     看起来像被裁切；这里保留 3% 的通透感，但不再让内容穿透 */
  background: rgba(250, 247, 244, 0.97);
  -webkit-backdrop-filter: blur(22px) saturate(180%);
  backdrop-filter: blur(22px) saturate(180%);
  border-bottom: 1px solid rgba(255, 255, 255, 0.6);
  box-shadow: 0 dp(6) dp(18) rgba(94, 45, 22, 0.04);
}

.nav-left {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
}

.nav-back,
.nav-more {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(34);
  height: dp(34);
  flex-shrink: 0;
}

.nav-back-icon {
  width: dp(20);
  height: dp(20);
}

.nav-more-icon {
  width: dp(20);
  height: dp(20);
}

.nav-title {
  flex: 1;
  overflow: hidden;
  color: #2b2119;
  font-size: dp(18);
  font-weight: 700;
  letter-spacing: dp(-0.2);
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* 小程序右上角有微信原生胶囊，更多按钮往左让位 */
/* #ifdef MP-WEIXIN */
.nav {
  padding-right: dp(96);
}
/* #endif */

.content {
  /* 吸顶导航与第一张卡片之间要留出呼吸空间；否则卡片会直接贴住导航底边 */
  padding: dp(12) dp(14) 0;
}

.card {
  margin-bottom: dp(14);
  padding: dp(14);
  @include glass-surface(dp(16), 20px);
}

/* ── 项目概览 ── */
.overview-card {
  padding: dp(14);
}

.overview-top {
  display: flex;
  align-items: flex-start;
}

.overview-cover {
  width: dp(80);
  height: dp(80);
  margin-right: dp(12);
  border-radius: dp(12);
  background: #f0eae4;
  flex-shrink: 0;
}

.overview-main {
  flex: 1;
  min-width: 0;
}

.overview-badges {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.status-badge,
.role-badge {
  display: inline-flex;
  align-items: center;
  padding: dp(2) dp(8);
  border: 1px solid transparent;
  border-radius: dp(999);
  font-size: dp(11);
  font-weight: 500;
  line-height: 1.4;
  white-space: nowrap;
}

.status-badge--pending {
  border-color: #fde3b3;
  background: #fff7e6;
  color: #d97706;
}

.status-badge--building {
  border-color: #c9efd0;
  background: #f6ffed;
  color: #52c41a;
}

.status-badge--finished {
  border-color: #f6c5ae;
  background: #fdebe4;
  color: #eb5c20;
}

.status-badge--archived {
  border-color: #e8e1da;
  background: #f3f4f6;
  color: #8b8179;
}

.role-badge {
  border-color: #f6c5ae;
  background: #fdebe4;
  color: #eb5c20;
}

.overview-progress-row {
  display: flex;
  align-items: center;
  margin-top: dp(4);
}

.overview-percent {
  margin-right: dp(8);
  color: #eb5c20;
  font-size: dp(24);
  font-weight: 800;
  letter-spacing: dp(-0.5);
  line-height: 1;
}

.overview-track {
  flex: 1;
  height: dp(7);
  overflow: hidden;
  border-radius: dp(999);
  background: #f3efea;
}

.overview-fill {
  height: 100%;
  border-radius: dp(999);
  background: #eb5c20;
}

.overview-address-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: dp(8);
}

.overview-address {
  display: flex;
  align-items: center;
  min-width: 0;
  flex: 1;
}

.overview-location {
  width: dp(12);
  height: dp(12);
  margin-right: dp(4);
  flex-shrink: 0;
}

.overview-address-text {
  overflow: hidden;
  color: #8b8179;
  font-size: dp(11);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.nav-pill {
  display: flex;
  align-items: center;
  margin-left: dp(6);
  padding: dp(2) dp(8);
  border: 1px solid rgba(255, 255, 255, 0.74);
  border-radius: dp(999);
  background: linear-gradient(
    135deg,
    rgba(255, 248, 243, 0.9) 0%,
    rgba(255, 235, 224, 0.64) 100%
  );
  -webkit-backdrop-filter: blur(14px) saturate(170%);
  backdrop-filter: blur(14px) saturate(170%);
  color: #eb5c20;
  font-size: dp(11);
  font-weight: 500;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.92),
    0 dp(1) dp(4) rgba(235, 92, 32, 0.05);
  flex-shrink: 0;
}

.nav-pill-icon {
  width: dp(10);
  height: dp(10);
  margin-right: dp(3);
  transform: rotate(45deg);
}

.overview-actions {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.nav-pill--checkin {
  background: linear-gradient(
    135deg,
    rgba(240, 255, 244, 0.9) 0%,
    rgba(224, 250, 232, 0.64) 100%
  );
  color: #087a1e;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.92),
    0 dp(1) dp(4) rgba(8, 122, 30, 0.05);
}

.nav-pill-icon--plain {
  transform: none;
}

.overview-footer {
  margin-top: dp(10);
}

.overview-stage {
  display: block;
  color: #2b2119;
  font-size: dp(12);
  font-weight: 700;
}

.overview-dates {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: dp(3);
}

.overview-date-text {
  color: #c4bbb2;
  font-size: dp(10);
}

.overview-overdue {
  color: #ff4d4f;
  font-size: dp(10);
  font-weight: 600;
}

/* ── 通用 section ── */
.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: dp(12);
}

.section-title {
  color: #2b2119;
  font-size: dp(14);
  font-weight: 700;
}

.link {
  display: flex;
  align-items: center;
  color: #8b8179;
  font-size: dp(11);
}

.feed-head-actions {
  display: flex;
  align-items: center;
  gap: dp(8);
}

.feed-report-btn {
  padding: dp(4) dp(10);
  border-radius: dp(999);
  background: #eb5c20;
  color: #fff;
  font-size: dp(10);
  font-weight: 600;
}

.link--accent {
  color: #eb5c20;
}

.link-chevron {
  width: dp(11);
  height: dp(11);
  margin-left: dp(2);
}

/* ── 待我处理 ── */
/* ── 项目竣工总报告 ── */
.completion-card {
  padding: dp(16);
}

.completion-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(32);
  height: dp(32);
  margin-right: dp(8);
  border-radius: dp(10);
  background: #fff2e8;
}

.completion-icon-img {
  width: dp(18);
  height: dp(18);
}

.completion-state {
  color: #8b8179;
  font-size: dp(11);
  flex-shrink: 0;
}

.completion-state--success {
  color: #00b42a;
}

.completion-state--danger {
  color: #f53f3f;
}

.completion-desc {
  display: block;
  color: #8b8179;
  font-size: dp(11);
  line-height: 1.6;
}

.completion-error {
  display: block;
  margin-top: dp(6);
  color: #f53f3f;
  font-size: dp(10);
  line-height: 1.5;
}

.completion-btn {
  width: 100%;
  height: dp(38);
  margin-top: dp(12);
  border: none;
  border-radius: dp(10);
  background: #eb5c20;
  color: #fff;
  font-size: dp(13);
  font-weight: 600;
  line-height: dp(38);
}

.completion-btn[disabled] {
  opacity: 0.6;
}

.completion-refresh {
  display: block;
  margin-top: dp(9);
  color: #eb5c20;
  font-size: dp(10);
  text-align: center;
}

.tasks-card {
  padding: dp(14);
}

.task-head-left {
  display: flex;
  align-items: center;
}

.task-alert {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(16);
  height: dp(16);
  margin-right: dp(5);
  border: 1px solid #fa8c16;
  border-radius: dp(999);
  color: #fa8c16;
  font-size: dp(11);
  font-weight: 700;
  line-height: 1;
}

.task-list {
  display: flex;
  flex-direction: column;
  gap: dp(12);
}

.task-card {
  padding: dp(12);
  @include glass-surface(dp(12), 14px);
  background: linear-gradient(
    135deg,
    rgba(255, 253, 249, 0.94) 0%,
    rgba(255, 245, 232, 0.74) 100%
  );
}

.task-top {
  display: flex;
  align-items: flex-start;
}

.task-doc-icon,
.task-yen-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(22);
  height: dp(22);
  margin-top: dp(1);
  margin-right: dp(8);
  border-radius: dp(5);
  flex-shrink: 0;
}

.task-doc-icon {
  background: #fff1e0;
}

.task-doc-image {
  width: dp(14);
  height: dp(14);
}

.task-yen-icon {
  border-radius: dp(6);
  background: #fa8c16;
  color: #fff;
  font-size: dp(12);
  font-weight: 700;
}

.task-main {
  flex: 1;
  min-width: 0;
}

.task-title {
  display: block;
  overflow: hidden;
  color: #2b2119;
  font-size: dp(12);
  font-weight: 700;
  line-height: 1.45;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.task-meta {
  display: flex;
  align-items: center;
  margin-top: dp(3);
  color: #c4bbb2;
  font-size: dp(10);
}

.task-meta--payment {
  margin-top: dp(8);
  padding-left: dp(30);
  color: #8b8179;
  font-size: dp(11);
}

.task-meta-icon {
  width: dp(11);
  height: dp(11);
  margin-right: dp(3);
}

.task-primary,
.task-ghost {
  display: flex;
  align-items: center;
  justify-content: center;
  height: dp(24);
  padding: 0 dp(7);
  border-radius: dp(999);
  font-size: dp(10);
  font-weight: 500;
  white-space: nowrap;
  flex-shrink: 0;
}

.task-primary {
  background: #eb5c20;
  color: #fff;
}

.task-primary:active {
  background: #c44710;
}

.task-ghost {
  margin-left: dp(5);
  border: 1px solid #e8e1da;
  background: #fff;
  color: #5a514a;
}

.task-actions {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.task-note {
  display: block;
  margin-top: dp(7);
  padding-left: dp(30);
  color: #c4bbb2;
  font-size: dp(10);
  line-height: 1.6;
}

.task-note--payment {
  margin-top: dp(8);
  padding-top: dp(8);
  border-top: 1px solid rgba(253, 230, 200, 0.6);
}

.payment-title-line {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: dp(4);
}

.payment-title-line .task-title {
  flex: 1;
  min-width: 0;
}

.task-amount {
  color: #d97706;
  font-size: dp(11);
  font-weight: 700;
  flex-shrink: 0;
}

.task-badge {
  padding: dp(1) dp(4);
  border: 1px solid #fde3b3;
  border-radius: dp(3);
  background: #fff7e6;
  color: #d97706;
  font-size: dp(9);
  line-height: 1.5;
  white-space: nowrap;
  flex-shrink: 0;
}

/* ── 阶段进度 ── */
.stage-count {
  color: #8b8179;
  font-size: dp(10);
  white-space: nowrap;
}

.stage-scroll {
  height: dp(360);
}

.stage-timeline {
  position: relative;
  padding-right: dp(2);
  padding-left: dp(24);
}

.stage-line {
  position: absolute;
  top: dp(8);
  bottom: dp(12);
  left: dp(11);
  width: dp(2);
  background: #f3efea;
}

.stage-item {
  position: relative;
  padding-bottom: dp(16);
}

.stage-item:last-child {
  padding-bottom: 0;
}

.stage-row {
  display: flex;
  align-items: flex-start;
  min-height: dp(24);
}

.stage-node {
  position: absolute;
  top: 0;
  left: dp(-24);
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(22);
  height: dp(22);
  border-radius: dp(999);
  background: #f3efea;
  z-index: 2;
}

.stage-node--done {
  background: #52c41a;
}

.stage-node--active {
  border: 2px solid #eb5c20;
  background: #fff;
}

.stage-node--locked {
  border: 1px solid #e8e1da;
  background: #f5f5f5;
}

.stage-node--warning {
  background: #fa8c16;
}

.stage-node-icon {
  width: dp(12);
  height: dp(12);
}

.stage-node-dot {
  width: dp(6);
  height: dp(6);
  border-radius: dp(999);
  background: #eb5c20;
}

.stage-node-dot--pending {
  background: #c4bbb2;
}

.stage-node-warning {
  color: #fff;
  font-size: dp(12);
  font-weight: 700;
}

.stage-body {
  flex: 1;
  min-width: 0;
}

.stage-title-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: dp(6);
}

.stage-name {
  color: #2b2119;
  font-size: dp(12);
  font-weight: 700;
}

.stage-badge {
  padding: dp(1) dp(5);
  border: 1px solid transparent;
  border-radius: dp(3);
  font-size: dp(9);
  font-weight: 500;
  line-height: 1.5;
  white-space: nowrap;
}

.stage-badge--done {
  border-color: #c9efd0;
  background: #f6ffed;
  color: #52c41a;
}

.stage-badge--active {
  border-color: #f6c5ae;
  background: #fdebe4;
  color: #eb5c20;
}

.stage-badge--warning {
  border-color: #fde3b3;
  background: #fff7e6;
  color: #d97706;
}

.stage-badge--locked,
.stage-badge--pending {
  background: #f5f5f5;
  color: #8b8179;
}

.stage-dates {
  display: block;
  margin-top: dp(2);
  color: #c4bbb2;
  font-size: dp(10);
}

.stage-right {
  display: flex;
  align-items: center;
  margin-left: dp(8);
  padding-top: dp(2);
  flex-shrink: 0;
}

.stage-percent {
  color: #eb5c20;
  font-size: dp(12);
  font-weight: 600;
}

.stage-percent--active {
  font-weight: 700;
}

.stage-chevron {
  width: dp(11);
  height: dp(11);
  margin-left: dp(2);
  transform: rotate(90deg);
  opacity: 0.65;
}

.stage-chevron--up {
  transform: rotate(-90deg);
}

.stage-items {
  margin-top: dp(10);
  padding: dp(9) dp(8);
  border-radius: dp(12);
  background: rgba(253, 235, 228, 0.65);
}

.stage-item-row {
  display: flex;
  align-items: center;
  min-height: dp(24);
}

.stage-item-row + .stage-item-row {
  margin-top: dp(7);
}

.stage-item-name {
  width: dp(64);
  overflow: hidden;
  color: #5a514a;
  font-size: dp(10);
  white-space: nowrap;
  text-overflow: ellipsis;
  flex-shrink: 0;
}

.stage-item-percent {
  width: dp(38);
  color: #eb5c20;
  font-size: dp(10);
  font-weight: 500;
  flex-shrink: 0;
}

.stage-item-track {
  flex: 1;
  height: dp(5);
  overflow: hidden;
  border-radius: dp(999);
  background: #e8e1da;
}

.stage-item-fill {
  height: 100%;
  border-radius: dp(999);
  background: #eb5c20;
}

.stage-history {
  display: flex;
  align-items: center;
  margin-left: dp(8);
  color: #8b8179;
  font-size: dp(10);
  flex-shrink: 0;
}

.stage-history-chevron {
  width: dp(9);
  height: dp(9);
  margin-left: dp(1);
}

.lock-note {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: dp(8);
  padding: dp(6) dp(9);
  border-radius: dp(8);
  background: #fcfaf8;
}

.lock-note-left {
  display: flex;
  align-items: center;
  color: #8b8179;
  font-size: dp(10);
}

.lock-note-icon {
  width: dp(10);
  height: dp(10);
  margin-right: dp(4);
}

.lock-note-chevron {
  width: dp(9);
  height: dp(9);
  opacity: 0.55;
}

.settlement-link {
  background: $color-primary-wash;
}

.settlement-link .lock-note-left {
  color: $color-primary-pressed;
  font-weight: 500;
}

.task-card--settlement {
  border-left: 3px solid $color-primary;
}

/* ── 工程动态 ── */
.feed-head-left {
  display: flex;
  align-items: center;
}

.feed-recent {
  margin-left: dp(8);
  color: #c4bbb2;
  font-size: dp(10);
}

.feed-post {
  padding: 0 dp(2);
}

.feed-author-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.feed-author-left {
  display: flex;
  align-items: center;
  min-width: 0;
}

.feed-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(36);
  height: dp(36);
  margin-right: dp(8);
  overflow: hidden;
  border-radius: dp(999);
  background: #fdebe4;
  flex-shrink: 0;
}

.feed-avatar-img {
  width: 100%;
  height: 100%;
}

.feed-avatar-text {
  color: #eb5c20;
  font-size: dp(14);
  font-weight: 700;
}

.feed-author-info {
  min-width: 0;
}

.feed-author-name {
  display: block;
  color: #2b2119;
  font-size: dp(12);
  font-weight: 700;
}

.feed-meta {
  display: flex;
  align-items: center;
  margin-top: dp(2);
  color: #8b8179;
  font-size: dp(10);
}

.feed-delta {
  margin-left: dp(4);
  color: #eb5c20;
  font-weight: 600;
}

.feed-time-wrap {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.feed-time {
  color: #c4bbb2;
  font-size: dp(10);
}

.feed-more {
  width: dp(14);
  height: dp(14);
  margin-left: dp(2);
  opacity: 0.55;
}

.feed-content {
  display: block;
  margin-top: dp(8);
  color: #5a514a;
  font-size: dp(11);
  line-height: 1.65;
}

.feed-media-grid {
  display: grid;
  gap: dp(5);
  margin-top: dp(8);
}

/* 单图 / 双图不要拉成一条细横条：横条会把 4:3 照片裁掉大半，水印也常被裁掉 */
.feed-media-grid--1 {
  display: flex;
}

.feed-media-grid--1 .feed-media {
  width: dp(120);
  height: dp(90);
  flex: none;
}

.feed-media-grid--2 {
  grid-template-columns: repeat(2, 1fr);
}

.feed-media-grid--2 .feed-media {
  height: dp(110);
}

.feed-media-grid--3 {
  grid-template-columns: repeat(3, 1fr);
}

.feed-media-grid--3 .feed-media {
  height: dp(92);
}

.feed-media-grid--4 {
  grid-template-columns: repeat(2, 1fr);
}

.feed-media-grid--4 .feed-media {
  height: dp(100);
}

.feed-media {
  position: relative;
  min-width: 0;
  overflow: hidden;
  border-radius: dp(8);
  background: #f3efea;
}

.feed-media-img {
  width: 100%;
  height: 100%;
}

.feed-media-more {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.4);
  color: #fff;
  font-size: dp(13);
  font-weight: 700;
}

.feed-footer {
  display: flex;
  justify-content: flex-end;
  margin-top: dp(7);
}

.feed-comment {
  display: flex;
  align-items: center;
  color: #8b8179;
  font-size: dp(11);
}

.feed-comment-icon {
  width: dp(13);
  height: dp(13);
  margin-right: dp(3);
}

/* ── 账目概览 ── */
.finance-head-left {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: dp(6);
}

.finance-badge {
  padding: dp(2) dp(6);
  border-radius: dp(999);
  background: #fff7e6;
  color: #d97706;
  font-size: dp(9);
  font-weight: 500;
}

.finance-grid {
  display: flex;
  flex-wrap: wrap;
  gap: dp(10);
}

.finance-tile {
  display: flex;
  align-items: center;
  width: calc(50% - #{dp(5)});
  padding: dp(9);
  border-radius: dp(12);
}

.finance-tile--accent {
  background: rgba(253, 235, 228, 0.65);
}

.finance-tile--green {
  background: rgba(246, 255, 237, 0.55);
}

.finance-tile--amber {
  background: rgba(255, 247, 230, 0.55);
}

.finance-tile--sand {
  background: rgba(247, 232, 220, 0.7);
}

.finance-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(32);
  height: dp(32);
  margin-right: dp(8);
  border: 1px solid rgba(255, 255, 255, 0.9);
  border-radius: dp(10);
  background: linear-gradient(
    135deg,
    rgba(255, 255, 255, 0.92) 0%,
    rgba(255, 255, 255, 0.72) 100%
  );
  -webkit-backdrop-filter: blur(8px) saturate(160%);
  backdrop-filter: blur(8px) saturate(160%);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.96),
    0 dp(1) dp(4) rgba(94, 45, 22, 0.05);
  flex-shrink: 0;
}

.finance-icon-img {
  width: dp(24);
  height: dp(24);
}

.finance-text {
  min-width: 0;
}

.finance-label {
  display: block;
  color: #8b8179;
  font-size: dp(10);
}

.finance-value {
  display: block;
  margin-top: dp(2);
  overflow: hidden;
  color: #2b2119;
  font-size: dp(11);
  font-weight: 700;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.next-node {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: dp(10);
  padding: dp(9) dp(10);
  border: 1px solid #fde3b3;
  border-radius: dp(12);
  background: rgba(255, 247, 230, 0.55);
}

.next-node-left {
  display: flex;
  align-items: center;
  min-width: 0;
}

.next-node-yen {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(16);
  height: dp(16);
  margin-right: dp(6);
  border-radius: dp(999);
  background: #fa8c16;
  color: #fff;
  font-size: dp(9);
  font-weight: 700;
  flex-shrink: 0;
}

.next-node-text {
  overflow: hidden;
  color: #2b2119;
  font-size: dp(11);
  font-weight: 500;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.next-node-amount {
  color: #2b2119;
  font-weight: 700;
}

.next-node-chevron {
  width: dp(11);
  height: dp(11);
  margin-left: dp(4);
  opacity: 0.65;
  flex-shrink: 0;
}

/* ── 门锁密码入口 ── */
.door-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: dp(14);
}

.door-card-left {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
}

.door-icon-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(42);
  height: dp(42);
  margin-right: dp(11);
  border: 1px solid rgba(255, 255, 255, 0.9);
  border-radius: dp(13);
  background: linear-gradient(
    135deg,
    rgba(255, 255, 255, 0.92) 0%,
    rgba(255, 255, 255, 0.72) 100%
  );
  -webkit-backdrop-filter: blur(8px) saturate(160%);
  backdrop-filter: blur(8px) saturate(160%);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.96),
    0 dp(1) dp(4) rgba(94, 45, 22, 0.05);
  flex-shrink: 0;
}

.door-icon {
  width: dp(26);
  height: dp(26);
}

.door-card-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.door-sub {
  margin-top: dp(3);
  overflow: hidden;
  color: #8a7e73;
  font-size: dp(10);
  line-height: 1.4;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.door-card-action {
  display: flex;
  align-items: center;
  color: #eb5c20;
  font-size: dp(11);
  font-weight: 600;
  flex-shrink: 0;
}

.door-chevron {
  width: dp(12);
  height: dp(12);
  margin-left: dp(3);
}

.door-card--disabled {
  opacity: 0.58;
}

.door-card--disabled .door-card-action {
  color: #9a8e84;
}

/* ── 联系与导航 ── */
.contacts-card {
  padding-bottom: dp(10);
}

.contact-list {
  margin-top: dp(4);
}

.contact-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: dp(8) 0;
}

.contact-row + .contact-row {
  border-top: 1px solid #fcfaf8;
}

.contact-row--address {
  border-top: 1px solid #fcfaf8;
}

.contact-left {
  display: flex;
  align-items: center;
  min-width: 0;
  flex: 1;
}

.contact-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(30);
  height: dp(30);
  margin-right: dp(8);
  flex-shrink: 0;
}

.contact-icon-img {
  width: dp(28);
  height: dp(28);
}

.contact-text {
  display: flex;
  align-items: center;
  min-width: 0;
}

.contact-label {
  width: dp(48);
  color: #c4bbb2;
  font-size: dp(10);
  flex-shrink: 0;
}

.contact-name {
  color: #2b2119;
  font-size: dp(11);
  font-weight: 600;
}

.contact-phone {
  margin-left: dp(8);
  color: #8b8179;
  font-size: dp(11);
}

.contact-address {
  overflow: hidden;
  color: #2b2119;
  font-size: dp(11);
  font-weight: 500;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.contact-call {
  display: flex;
  align-items: center;
  padding: dp(3) dp(8);
  border: 1px solid rgba(255, 255, 255, 0.74);
  border-radius: dp(999);
  background: linear-gradient(
    135deg,
    rgba(255, 248, 243, 0.9) 0%,
    rgba(255, 235, 224, 0.64) 100%
  );
  -webkit-backdrop-filter: blur(14px) saturate(170%);
  backdrop-filter: blur(14px) saturate(170%);
  color: #eb5c20;
  font-size: dp(10);
  font-weight: 500;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.92),
    0 dp(1) dp(4) rgba(235, 92, 32, 0.05);
  flex-shrink: 0;
}

.contact-call-icon {
  width: dp(11);
  height: dp(11);
  margin-right: dp(3);
}

.empty-text {
  padding: dp(20) 0;
  color: #c4bbb2;
  font-size: dp(11);
  text-align: center;
}

/* ── 状态 ── */
.state-block {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: dp(90) dp(28);
}

.state-icon {
  width: dp(48);
  height: dp(48);
  margin-bottom: dp(10);
}

.state-title {
  margin-bottom: dp(4);
  color: #2b2119;
  font-size: dp(16);
  font-weight: 700;
}

.state-text {
  color: #8b8179;
  font-size: dp(12);
  line-height: 1.6;
  text-align: center;
}

.state-btn {
  height: dp(38);
  margin-top: dp(14);
  padding: 0 dp(20);
  border-radius: dp(999);
  background: #eb5c20;
  color: #fff;
  font-size: dp(13);
  font-weight: 600;
  line-height: dp(38);
}

/* ── 底部面板 ── */
.sheet-mask {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 1000;
  display: flex;
  align-items: flex-end;
  background: rgba(29, 33, 41, 0.5);
}

.sheet {
  width: 100%;
  max-height: 78vh;
  overflow-y: auto;
  padding: dp(16) dp(16) calc(#{dp(16)} + env(safe-area-inset-bottom));
  border-radius: dp(20) dp(20) 0 0;
  @include glass-sheet;
}

.sheet--comments {
  display: flex;
  flex-direction: column;
  max-height: 75vh;
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

.history-list {
  padding-top: dp(12);
}

.history-row {
  display: flex;
  align-items: flex-start;
  padding: dp(10) 0;
  border-bottom: 1px solid #f8f4ef;
}

.history-row:last-child {
  border-bottom: none;
}

.history-dot {
  width: dp(8);
  height: dp(8);
  margin-top: dp(5);
  margin-right: dp(10);
  border-radius: dp(999);
  background: #eb5c20;
  flex-shrink: 0;
}

.history-main {
  flex: 1;
}

.history-change {
  display: flex;
  align-items: center;
  font-size: dp(13);
  font-weight: 700;
}

.history-from {
  color: #8b8179;
}

.history-arrow {
  margin: 0 dp(6);
  color: #c4bbb2;
}

.history-to {
  color: #eb5c20;
}

.history-meta {
  display: block;
  margin-top: dp(3);
  color: #8b8179;
  font-size: dp(11);
}

.history-remark {
  display: block;
  margin-top: dp(4);
  color: #5a514a;
  font-size: dp(11);
  line-height: 1.5;
}

.comment-scroll {
  flex: 1;
  max-height: dp(360);
}

.comment-list {
  padding: dp(8) 0;
}

.comment-row {
  display: flex;
  align-items: flex-start;
  padding: dp(8) 0;
}

.comment-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(30);
  height: dp(30);
  margin-right: dp(8);
  border-radius: dp(999);
  background: #fdebe4;
  color: #eb5c20;
  font-size: dp(12);
  font-weight: 700;
  flex-shrink: 0;
}

.comment-main {
  flex: 1;
  min-width: 0;
}

.comment-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.comment-name {
  color: #2b2119;
  font-size: dp(12);
  font-weight: 600;
}

.comment-time {
  color: #c4bbb2;
  font-size: dp(10);
}

.comment-content {
  display: block;
  margin-top: dp(3);
  color: #5a514a;
  font-size: dp(12);
  line-height: 1.5;
}

.comment-input-row {
  display: flex;
  align-items: center;
  padding-top: dp(10);
  border-top: 1px solid #f3efea;
}

.comment-input {
  flex: 1;
  height: dp(38);
  padding: 0 dp(12);
  border-radius: dp(999);
  background: #faf7f4;
  color: #2b2119;
  font-size: dp(12);
}

.comment-placeholder {
  color: #c4bbb2;
}

.comment-submit {
  display: flex;
  align-items: center;
  justify-content: center;
  height: dp(34);
  margin-left: dp(8);
  padding: 0 dp(14);
  border-radius: dp(999);
  background: #eb5c20;
  color: #fff;
  font-size: dp(12);
  font-weight: 600;
}

.comment-submit--disabled {
  opacity: 0.45;
}

/* ── 考察记录 ── */
.visit-head-left {
  display: flex;
  align-items: baseline;
  gap: dp(6);
}

.visit-count {
  font-size: dp(10);
  color: #8b8179;
}

.visit-list {
  margin-top: dp(10);
}

.visit-row {
  display: flex;
  align-items: flex-start;
  gap: dp(8);
  padding: dp(10) 0;
}

.visit-row + .visit-row {
  border-top: 1px solid #f0ebe6;
}

.visit-rail {
  width: dp(8);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: dp(5);
  align-self: stretch;
}

.visit-dot {
  width: dp(8);
  height: dp(8);
  border-radius: 50%;
  background: #00b42a;
  flex-shrink: 0;
}

.visit-dot--abnormal {
  background: #f53f3f;
}

.visit-line {
  width: 1px;
  flex: 1;
  min-height: dp(8);
  margin-top: dp(4);
  background: #e8e1da;
}

.visit-row:last-child .visit-line {
  display: none;
}

.visit-main {
  flex: 1;
  min-width: 0;
}

.visit-line-row {
  display: flex;
  align-items: center;
  gap: dp(5);
  flex-wrap: wrap;
}

.visit-name {
  font-size: dp(13);
  font-weight: 600;
  color: #2b2119;
}

.visit-role {
  padding: dp(1) dp(5);
  border-radius: dp(7);
  background: #f3efea;
  color: #615850;
  font-size: dp(9);
}

.visit-abnormal {
  padding: dp(1) dp(5);
  border-radius: dp(7);
  background: #ffece8;
  color: #b22a26;
  font-size: dp(9);
  font-weight: 600;
}

.visit-meta {
  display: block;
  margin-top: dp(3);
  font-size: dp(10);
  color: #8b8179;
}

.visit-remark {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  margin-top: dp(4);
  font-size: dp(11);
  color: #51463e;
  line-height: 1.6;
}

.visit-thumbs {
  display: flex;
  gap: dp(4);
  flex-shrink: 0;
}

.visit-thumb {
  width: dp(42);
  height: dp(42);
  border-radius: dp(8);
  background: #f8f4ef;
}
</style>
