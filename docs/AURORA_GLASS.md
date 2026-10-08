# Aurora Glass 视觉与动效

2026-10-08 用户选定：沉浸玻璃风格、动效“丰富但不挡操作”。取代此前的黑金 / 深夜影院方案。

## 视觉

- 令牌唯一来源是 `src/styles/base.css`；`glass.css` 负责极光背景、玻璃面与渐变标题，`motion.css` 负责动效。
- 底色深紫黑 `--bg`；浮层用 `--glass` 半透明加 `backdrop-filter`。
- 主操作用紫 → 品红 → 玫红渐变 `--accent-fill`，上面只放白字 `--accent-ink`；每个色标与白字对比度都 ≥ 4.5。
- 深色背景上的强调文字用浅紫 `--primary`；标题用浅色渐变 `--heading-ink`，不支持时回落为纯色。
- 短视频：画面铺满到底部悬浮胶囊导航上方；顶栏、底部信息条、右侧圆形操作栏都浮在画面上，不随闲置隐藏。
- 长片：画面在上，下方玻璃控制卡；手机上为两行（声音·播放·收藏 / 清晰度·倍速·全屏·更多）。
- 不在 `.topbar`、`.sheet-card` 及页面容器上加 `backdrop-filter`：会成为固定定位子元素的包含块。

## 动效

- 只动合成层属性（transform / translate / scale / opacity / clip-path / filter / background-position）。
- 弹簧曲线 `--ease-spring*` 为阻尼弹簧采样的 `linear()`。
- 已有效果：页面转场（模糊 + 缩放）、卡片依次入场与滚动入场、悬停 3D 倾斜与光斑、骨架流光、导航胶囊滑动与图标弹跳、主按钮光泽扫过、收藏爆心粒子、双击涟漪、切换视频标题滑入、菜单弹出、弹窗弹性进场。
- 时间驱动的入场只用 `backwards` 填充，结束后不残留 transform。
- 系统“减少动态效果”时全部关闭；`components/fx.ts` 的效果在此时根本不创建。
