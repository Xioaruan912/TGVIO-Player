# TGVIO-Player

TGVIO 私人视频播放器的网页前端（Vite + TypeScript，无框架）。后端、镜像和部署都在 [TGVIO](https://github.com/Xioaruan912/TGVIO) 仓库，它通过 `player-web.lock` 固定使用本仓库的某个提交。

## 功能

- 短视频上下滑刷：三个复用的 `<video>`、相邻预热、未看过的优先。
- 长视频播放器：续播、倍速、清晰度、手势（双击跳转、拖动、长按快进）、画中画、全屏；手机上看收藏的短片时使用窄控制条，画面更大。
- 片库按日期/文件夹浏览，筛选与排序；收藏、集合（收藏后可直接选集合）、相似封面。
- 永久删除（可撤销）、疑似重复审核、看过标记与期限设置。
- 隐私锁、闲置自动退出、声音确认、PWA 安装。

## 开发

```sh
npm ci
VITE_PLAYER_MOCK=true npm run dev   # 只用模拟数据，不连接真实服务
npm run check                        # 规则与行数预算 + 单元测试 + 类型检查与构建
npm run test:browser                 # 需要本机 Chrome 与 FFmpeg
```

先读 [AGENTS.md](AGENTS.md)：它有规则，也有模块地图，按地图直接找到要改的文件。界面边界见 [docs/DESIGN.md](docs/DESIGN.md)，视觉与动效见 [docs/AURORA_GLASS.md](docs/AURORA_GLASS.md)。

## 发布

1. 在本仓库提交并推送到 `main`。
2. 在 TGVIO 中把 `player-web.lock` 改成新提交，单独提交后按 TGVIO 的流程部署。
