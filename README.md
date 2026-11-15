# Quiet TV 在线图标库

Quiet TV 定制应用图标。当前 65 款苹果风纯图标，每款提供长方形、圆角方形和圆形，共 195 个形状版本。全部为 RGBA 8-bit PNG，外轮廓以外透明。

| 形状 | 正式图 | 缩略图 |
| --- | --- | --- |
| 长方形 | 720×405 | 320×180 |
| 圆角方形 | 512×512 | 256×256 |
| 圆形 | 512×512 | 256×256 |

圆角方形和圆形共用各自主题的同一张方形母稿，统一主体比例、视觉中心和圆形安全区，保留原标识、配色及苹果风格。圆角方形使用统一的连续曲线轮廓，圆形使用标准圆轮廓；均在导出时完成抗锯齿。PNG 无损压缩，不进行调色板减色。

[在线浏览与按需下载](https://beatsad.github.io/quiet-tv-icons/)  [圆角方形](https://beatsad.github.io/quiet-tv-icons/?shape=square)  [圆形](https://beatsad.github.io/quiet-tv-icons/?shape=circle)

网页可切换形状、搜索和逐个下载；网页图片从同一份 `catalog.json` 获取，避免下载链接与客户端目录分离。客户端先读取小型签名目录，只请求可见缩略图和选中的正式图，不预先下载全部形状。已应用图标独立保存，离线可用。目录使用 RSA SHA-256 签名，图片按大小及 SHA-256 校验。应用名称和品牌标识用于识别对应应用，不代表官方出品或背书。

下载顺序与 Quiet TV 在线更新一致：ghfast.top、gh-proxy.com、v4.gh-proxy.org，然后 GitHub Pages、GitHub Raw。第三方镜像可能不可用，客户端会依次回退并验证内容。

`latest.signed.json` 为客户端目录，`catalog.json` 为网页目录，`public-key.der` 为公开验签密钥。原长方形图片路径 `images/apple/v1/` 保持不变，新增两种形状使用 `images/apple/v2/`，文件名分别为 `<id>-square.png` 和 `<id>-circle.png`。本批天气、媒体中心、电信 IPTV、文件管理器三种形状使用 `images/apple/v3/`。当前目录 revision 为 4，应用匹配规则 revision 为 2；新增或修订使用新版本路径并递增目录 revision。私钥只保存在维护者本地。

验证：`python3 tools/validate.py verify --root .`。CI 验证通过后才部署 GitHub Pages。

签名目录内的 `matches` 同步提供主题别名、核实包名和 `autoMatch` 确认状态，规则 revision 随规则内容变化递增，目录 revision 随任何发布变化递增。新主题必须一同登记匹配规则；身份待核对的项目使用 `autoMatch=false`，客户端不自动勾选。旧客户端可以读取同一目录并忽略新增字段，支持在线匹配规则的客户端优先使用已验签规则。

仅修改规则时使用 `tools/validate.py sign --catalog catalog.json --matches <规则JSON> --key <仓库外私钥> --revision <新目录版本> --output .`，继续复用不可变图片路径。图片、别名和包名记录应逐项核对，不将待核对身份改为自动确认。

新增系统与媒体图标包括天气、媒体中心、电信 IPTV、文件管理器。电信 IPTV 参考[中国电信官网](https://www.189.cn/)图形标识，并结合电视轮廓原创适配；各地客户端包名尚未核实，保持待确认状态，不自动勾选。其余三款是通用入口图标，只登记名称别名，不推测包名。
