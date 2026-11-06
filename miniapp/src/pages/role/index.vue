<template>
  <view class="page">
    <!-- 顶部装饰：3D 建筑与安全帽（设计稿的混合图层） -->
    <view class="hero">
      <image class="hero-building" src="/static/images/role-hero.jpg" mode="aspectFill" />
      <view class="hero-fade" />
      <view class="hard-hat">
        <view class="hard-hat-top" />
        <view class="hard-hat-band" />
      </view>
    </view>

    <view class="content" :style="{ paddingTop: `${safeTop}px` }">
      <!-- 自定义导航：左侧返回；右侧留给微信原生胶囊，不画假胶囊 -->
      <view class="nav">
        <view class="nav-back-wrap" @tap="goBack">
          <image class="nav-back" src="/static/images/icon-back.png" mode="aspectFit" />
        </view>
      </view>

      <!-- 品牌与主文案 -->
      <view class="brand">
        <view class="brand-logo">
          <gc-brand-logo :src="branding.logoUrl" mode="aspectFit" />
        </view>
        <text class="brand-name">{{ branding.name }}</text>
      </view>

      <text class="headline">角色由邀请确定</text>
      <view class="subtitles">
        <text class="subtitle">不同角色</text>
        <text class="subtitle">不同视角</text>
        <text class="subtitle">同一项目</text>
        <text class="subtitle">共同协作</text>
      </view>
      <text class="role-note">工长、监理、业主在邀请时固定，不能自行切换；业主可以参与多个项目</text>

      <!-- 角色卡片 -->
      <view class="cards">
        <view v-for="role in ROLES" :key="role.key" class="card">
          <!-- 右侧实景图 + 白色渐变覆盖层（模拟设计稿的左侧羽化） -->
          <image class="card-image" :src="role.image" mode="aspectFill" />
          <view class="card-image-fade" />

          <view class="card-body">
            <view class="card-head">
              <view class="avatar" :style="{ backgroundColor: role.avatarBg }">
                <image class="avatar-icon" :src="role.avatarIcon" mode="aspectFit" />
              </view>
              <view class="card-title-wrap">
                <text class="card-title">{{ role.name }}</text>
                <text class="card-subtitle">{{ role.subtitle }}</text>
              </view>
            </view>
            <text class="card-desc">{{ role.description }}</text>
          </view>

        </view>
      </view>
    </view>

    <!-- 底部品牌与天际线 -->
    <view class="footer">
      <view class="footer-divider">
        <view class="footer-line" />
        <image class="footer-shield" src="/static/images/icon-shield-outline.png" mode="aspectFit" />
        <view class="footer-line footer-line--right" />
      </view>
      <text class="footer-text">{{ branding.name }} · 让装修工程更透明、更可控</text>
      <image class="skyline" src="/static/images/role-skyline.png" mode="aspectFill" />
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { branding, loadBranding } from '../../store/branding'
import { ROLES } from '../../config'
import { getToken } from '../../store/session'

const safeTop = ref(0)

onLoad(() => {
  loadBranding()
  const info = uni.getSystemInfoSync()
  safeTop.value = info.statusBarHeight || 12

  // 没登录直接回登录页；本页是登录后的引导
  if (!getToken()) {
    uni.redirectTo({ url: '/pages/login/index' })
  }
})

function goBack() {
  // 本页是角色说明页；栈里没有上一页时回到项目列表，
  // 而不是登录页（登录页会把已登录用户再次弹回来）
  const pages = getCurrentPages()
  if (pages.length > 1) {
    uni.navigateBack({ fail: () => uni.reLaunch({ url: '/pages/projects/index' }) })
    return
  }
  uni.reLaunch({ url: '/pages/projects/index' })
}
</script>

<style scoped lang="scss">
.page {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  min-height: 100vh;
  background: #faf5f0;
  overflow: hidden;
}

/* ── 顶部装饰 ── */
.hero {
  position: absolute;
  top: 0;
  right: 0;
  width: dp(270);
  height: dp(220);
  opacity: 0.8;
  overflow: hidden;
  pointer-events: none;
  z-index: 0;
}

.hero-building {
  width: 100%;
  height: 100%;
  opacity: 0.35;
}

.hero-fade {
  position: absolute;
  inset: 0;
  background: linear-gradient(
      180deg,
      rgba(250, 246, 241, 0) 0%,
      rgba(250, 246, 241, 0.7) 58%,
      #faf5f0 100%
    ),
    linear-gradient(90deg, #faf5f0 0%, rgba(250, 246, 241, 0.1) 42%, rgba(250, 246, 241, 0) 70%);
}

.hard-hat {
  position: absolute;
  right: dp(20);
  bottom: dp(16);
  width: dp(96);
  height: dp(56);
  transform: rotate(-4deg);
}

.hard-hat-top {
  width: 100%;
  height: dp(44);
  border-radius: dp(48) dp(48) dp(6) dp(6);
  background: linear-gradient(45deg, #f59e0b, #facc15 55%, #fcd34d);
  border-bottom: dp(4) solid rgba(217, 119, 6, 0.6);
  box-shadow: 0 dp(6) dp(12) rgba(180, 83, 9, 0.18);
}

.hard-hat-band {
  position: absolute;
  top: dp(30);
  left: 0;
  width: 100%;
  height: dp(8);
  border-radius: dp(999);
  background: rgba(251, 191, 36, 0.8);
  box-shadow: inset 0 dp(1) dp(2) rgba(255, 255, 255, 0.35);
}

/* ── 内容 ── */
.content {
  position: relative;
  z-index: 20;
  display: flex;
  flex-direction: column;
}

.nav {
  display: flex;
  align-items: center;
  height: dp(44);
  padding: 0 dp(20);
  /* 右侧留给微信原生胶囊 */
  padding-right: dp(100);
}

.nav-back-wrap {
  padding: dp(4);
}

.nav-back {
  width: dp(20);
  height: dp(20);
}

.brand {
  display: flex;
  align-items: center;
  padding: 0 dp(24);
  margin-top: dp(6);
}

.brand-logo {
  width: dp(44);
  height: dp(44);
  border-radius: dp(12);
  margin-right: dp(12);
  box-shadow: 0 dp(4) dp(12) rgba(235, 92, 32, 0.18);
}

.brand-name {
  font-size: dp(24);
  font-weight: 800;
  color: #2b1a12;
  letter-spacing: dp(-0.3);
}

.headline {
  display: block;
  padding: 0 dp(24);
  margin-top: dp(12);
  font-size: dp(23);
  font-weight: 800;
  color: #241c17;
  letter-spacing: dp(-0.3);
}

.subtitles {
  display: flex;
  flex-wrap: wrap;
  padding: 0 dp(24);
  margin-top: dp(8);
  margin-bottom: dp(18);
}

.subtitle {
  font-size: dp(12);
  font-weight: 500;
  color: #84786f;
  margin-right: dp(8);
  letter-spacing: dp(0.3);
}

.role-note {
  padding: 0 dp(24);
  margin-bottom: dp(14);
  font-size: dp(11);
  line-height: 1.5;
  color: #a09388;
}

/* ── 角色卡片 ── */
.cards {
  padding: 0 dp(16);
  margin-top: dp(2);
}

.card {
  position: relative;
  display: flex;
  align-items: center;
  min-height: dp(112);
  padding: dp(15);
  margin-bottom: dp(14);
  background: $color-surface;
  border: 2px solid #f3efea;
  border-radius: dp(16);
  box-shadow: 0 dp(2) dp(12) rgba(0, 0, 0, 0.03);
  overflow: hidden;
  transition: border-color 0.16s ease, box-shadow 0.16s ease;
}

.card-image {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 54%;
  height: 100%;
  z-index: 10;
}

/* 用白色渐变把实景图与白色卡片融合，替代 CSS mask ——
   小程序各端对 mask-image 支持不一致；JPG 也比带 alpha 的 PNG 小得多 */
.card-image-fade {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 54%;
  z-index: 11;
  pointer-events: none;
  background: linear-gradient(
    90deg,
    #ffffff 0%,
    rgba(255, 255, 255, 0.82) 26%,
    rgba(255, 255, 255, 0) 68%
  );
}

.card-body {
  position: relative;
  z-index: 20;
  max-width: 70%;
  display: flex;
  flex-direction: column;
}

.card-head {
  display: flex;
  align-items: center;
}

.avatar {
  width: dp(48);
  height: dp(48);
  border-radius: 50%;
  margin-right: dp(12);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  box-shadow: 0 dp(2) dp(6) rgba(94, 45, 22, 0.12);
}

.avatar-icon {
  width: dp(24);
  height: dp(24);
}

.card-title-wrap {
  display: flex;
  flex-direction: column;
}

.card-title {
  font-size: dp(19);
  font-weight: 700;
  color: #2b2119;
  line-height: 1.2;
  letter-spacing: dp(-0.2);
}

.card-subtitle {
  margin-top: dp(2);
  font-size: dp(13);
  font-weight: 500;
  color: #5b5048;
}

.card-desc {
  margin-top: dp(10);
  padding-left: dp(1);
  font-size: dp(11);
  color: #71675f;
  line-height: 1.5;
  /* 描述文字会压到右侧实景图的羽化区上；给一圈白色柔光保证可读，
     而不加一块白色底板（那会切断图片的融合感） */
  text-shadow: 0 1px 2px rgba(255, 255, 255, 0.95), 0 0 6px rgba(255, 255, 255, 0.85);
}

/* ── 底部 ── */
.footer {
  position: relative;
  z-index: 10;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: dp(36);
  padding-bottom: 0;
}

.footer-divider {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 0 dp(48);
  margin-bottom: dp(8);
}

.footer-line {
  flex: 1;
  height: 1px;
  background: linear-gradient(90deg, rgba(203, 215, 230, 0), #d8cbc2);
}

.footer-line--right {
  background: linear-gradient(90deg, #d8cbc2, rgba(203, 215, 230, 0));
}

.footer-shield {
  width: dp(16);
  height: dp(16);
  margin: 0 dp(12);
}

.footer-text {
  font-size: dp(12);
  color: #8a7e73;
  letter-spacing: dp(-0.2);
  margin-bottom: dp(28);
}

.skyline {
  display: block;
  width: 100%;
  height: dp(95);
}
</style>
