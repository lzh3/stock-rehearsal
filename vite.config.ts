import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5183,
    open: false,
    proxy: {
      // K 线历史（push2his）：/api/em-his/api/qt/stock/kline/get -> https://push2his.eastmoney.com/api/qt/stock/kline/get
      // 注意：必须放在 /api/em-quote 之后没有歧义，这里用独立前缀避免与报价域混淆
      '/api/em-his': {
        target: 'https://push2his.eastmoney.com',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api\/em-his/, ''),
        headers: {
          Host: 'push2his.eastmoney.com',
          Origin: 'https://quote.eastmoney.com',
          Referer: 'https://quote.eastmoney.com/',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131 Safari/537.36',
          Accept: 'application/json, text/plain, */*',
        },
      },
      // 报价/快照（push2）：市值、PE、PB、行业、板块排行
      '/api/em-quote': {
        target: 'https://push2.eastmoney.com',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api\/em-quote/, ''),
        headers: {
          Host: 'push2.eastmoney.com',
          Origin: 'https://quote.eastmoney.com',
          Referer: 'https://quote.eastmoney.com/',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131 Safari/537.36',
          Accept: 'application/json, text/plain, */*',
        },
      },
      '/api/tencent': {
        target: 'https://web.ifzq.gtimg.cn',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api\/tencent/, ''),
        headers: {
          Host: 'web.ifzq.gtimg.cn',
          Referer: 'https://gu.qq.com/',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131 Safari/537.36',
        },
      },
      '/api/sina': {
        target: 'https://money.finance.sina.com.cn',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api\/sina/, ''),
        headers: {
          Host: 'money.finance.sina.com.cn',
          Referer: 'https://finance.sina.com.cn/',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131 Safari/537.36',
        },
      },
    },
  },
});
