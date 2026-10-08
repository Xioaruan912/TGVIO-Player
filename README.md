# TGVIO-Player

TGVIO 私人视频播放器的网页前端（Vite + TypeScript）。后端、镜像和部署都在 [TGVIO](https://github.com/Xioaruan912/TGVIO) 仓库，它通过 `player-web.lock` 固定使用本仓库的某个提交。

## 开发

```sh
npm ci
VITE_PLAYER_MOCK=true npm run dev   # 只用模拟数据，不连接真实服务
npm run check                        # 规则检查 + 单元测试 + 构建
npm run test:browser                 # 需要本机 Chrome 与 FFmpeg
```

## 发布

1. 在本仓库提交并推送到 `main`。
2. 在 TGVIO 中把 `player-web.lock` 改成新提交，提交后按 TGVIO 的流程部署。

开发约定见 [AGENTS.md](AGENTS.md)，界面边界见 [docs/DESIGN.md](docs/DESIGN.md)，视觉与动效见 [docs/AURORA_GLASS.md](docs/AURORA_GLASS.md)。
