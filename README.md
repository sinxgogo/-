# 港币汇率提醒

这是一个可安装到安卓 Chrome 主屏幕的 PWA，监控 `HKD -> CNY` 参考汇率，并在达到目标时发送本机通知。

## 使用

1. 将这些文件部署到一个 HTTPS 静态网站空间（例如 GitHub Pages、Cloudflare Pages 或 Netlify）。安卓 Chrome 的安装、通知和 Service Worker 需要 HTTPS；直接用局域网 HTTP 地址打开不满足浏览器安全要求。
2. 发布后，在安卓手机 Chrome 打开该 HTTPS 网址。
3. 在 Chrome 菜单选择“添加到主屏幕”或“安装应用”。
4. 设置目标汇率并允许通知。目标判断为：`1 HKD >= 目标 CNY`。

本机预览可在工作区目录运行静态服务器，例如：

```powershell
node -e "const http=require('http'),fs=require('fs'),path=require('path');const root=process.cwd();http.createServer((req,res)=>{let p=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(p==='/')p='/index.html';const f=path.resolve(root,'.'+p);fs.readFile(f,(e,b)=>{if(e){res.writeHead(404);return res.end()}res.writeHead(200);res.end(b)})}).listen(8000)"
```

浏览器的 `localhost` 例外仅用于这台电脑上的预览，不能代替手机可访问的 HTTPS 部署。

## 提醒机制

- 应用打开时会立即刷新，并每小时检查一次。
- Android Chrome 支持时，会登记每日后台检查；系统可能因省电策略延迟后台任务。
- 每天最多发送一次达到目标提醒，目标和最近一次汇率保存在本机。
- 数据来源为 Frankfurter 的欧洲央行参考价，不代表银行、找换店或支付平台的实际成交价。
- 直接双击 `index.html` 只能查看页面，通知和 Service Worker 需要 `localhost` 或 HTTPS。
