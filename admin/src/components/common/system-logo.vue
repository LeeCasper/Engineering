<template>
  <div class="app-logo">
    <svg width="100%" height="100%" viewBox="0 0 96 96" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="gc-logo-gradient" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="#2575FC" />
          <stop offset="100%" stop-color="#165DFF" />
        </linearGradient>
      </defs>
      <rect width="96" height="96" rx="22" fill="url(#gc-logo-gradient)" />
      <path
        transform="translate(24,24) scale(2)"
        fill="#fff"
        d="M12 2L2 9.5V20C2 21.1 2.9 22 4 22H20C21.1 22 22 21.1 22 20V9.5L12 2ZM14.5 19H9.5V14H14.5V19ZM19.5 19H16.5V13C16.5 12.45 16.05 12 15.5 12H8.5C7.95 12 7.5 12.45 7.5 13V19H4.5V10.45L12 4.83L19.5 10.45V19Z"
      />
    </svg>
  </div>
</template>

<style scoped>
.app-logo {
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
