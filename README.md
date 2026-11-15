# Quiet TV 在线图标库

Quiet TV 定制应用图标。覆盖 68 款应用和通用入口，提供苹果风格 68 款、拟物风格 65 款。每款提供圆角矩形、圆角方形和圆形，共 399 个形状版本及对应缩略图。全部为 RGBA 8-bit PNG，外轮廓以外透明。

| 形状 | 正式图 | 缩略图 |
| --- | --- | --- |
| 圆角矩形 | 720×405 | 320×180 |
| 圆角方形 | 512×512 | 256×256 |
| 圆形 | 512×512 | 256×256 |

每种风格的三种形状沿用同款已选设计，保留应用标识和配色。苹果风格的圆角方形和圆形共用方形母稿；拟物风格使用写实的皮革、金属、玻璃、木纹与陶瓷，圆角矩形延展背景，圆形缩放主体并留出安全区，避免裁掉镜头、提手和旋钮。圆角方形使用统一的连续曲线轮廓，圆形使用标准圆轮廓；均在导出时完成抗锯齿。先按上表导出实际像素尺寸，再进行 PNG 无损压缩，不进行调色板减色。

[在线浏览与按需下载](https://beatsad.github.io/quiet-tv-icons/)  [拟物风格](https://beatsad.github.io/quiet-tv-icons/?style=skeuo)  [圆角方形](https://beatsad.github.io/quiet-tv-icons/?shape=square)  [圆形](https://beatsad.github.io/quiet-tv-icons/?shape=circle)

网页按图标风格分类，当前提供苹果风格和拟物风格；风格选项从目录中已有图标生成。可组合风格、形状、批次和搜索筛选，并逐个下载；链接中的 `style=apple` 与 `shape=square` 等参数可保留风格和形状选择。网页图片从同一份 `catalog.json` 获取，避免下载链接与客户端目录分离。客户端先读取小型签名目录，只请求可见缩略图和选中的正式图，不预先下载全部形状。已应用图标独立保存，离线可用。目录使用 RSA SHA-256 签名，图片按大小及 SHA-256 校验。应用名称和品牌标识用于识别对应应用，不代表官方出品或背书。

下载顺序与 Quiet TV 在线更新一致：ghfast.top、gh-proxy.com、v4.gh-proxy.org，然后 GitHub Pages、GitHub Raw。第三方镜像可能不可用，客户端会依次回退并验证内容。

`latest.signed.json` 为客户端目录，`catalog.json` 为网页目录，`public-key.der` 为公开验签密钥。原长方形图片路径 `images/apple/v1/` 保持不变，新增两种形状使用 `images/apple/v2/`，文件名分别为 `<id>-square.png` 和 `<id>-circle.png`。本批天气、媒体中心、电信 IPTV、文件管理器三种形状使用 `images/apple/v3/`。拟物风格三种形状使用独立路径 `images/skeuo/v1/`，文件名为 `<id>-rectangle.png`、`<id>-square.png` 和 `<id>-circle.png`。原有苹果风格资源保持原路径和原字节。新增应用助手、通知、天光云影使用 `images/apple/v4/`。当前目录 revision 为 7，应用匹配规则 revision 为 3；新增或修订使用新版本路径并递增目录 revision。私钥只保存在维护者本地。

验证：`python3 tools/validate.py verify --root .`。CI 验证通过后才部署 GitHub Pages。

签名目录内的 `matches` 同步提供主题别名、核实包名和 `autoMatch` 确认状态，规则 revision 随规则内容变化递增，目录 revision 随任何发布变化递增。新主题必须一同登记匹配规则；身份待核对的项目使用 `autoMatch=false`，客户端不自动勾选。旧客户端可以读取同一目录并忽略新增字段，支持在线匹配规则的客户端优先使用已验签规则。

仅修改规则时使用 `tools/validate.py sign --catalog catalog.json --matches <规则JSON> --key <仓库外私钥> --revision <新目录版本> --output .`，继续复用不可变图片路径。图片、别名和包名记录应逐项核对，不将待核对身份改为自动确认。

新增系统与媒体图标包括天气、媒体中心、电信 IPTV、文件管理器。电信 IPTV 参考[中国电信官网](https://www.189.cn/)图形标识，并结合电视轮廓原创适配；各地客户端包名尚未核实，保持待确认状态，不自动勾选。其余三款是通用入口图标，只登记名称别名，不推测包名。

新增苹果风格包括应用助手（APK 安装）、通知和天光云影。天光云影参考[原作者电视端标识](https://github.com/yaoxieyoulei/mytv-android/blob/feature/ui/tv/src/main/res/mipmap-xxxhdpi/ic_launcher.png)的蓝底光球；原版包名 `top.yogiczy.slcs.tv` 已按[构建配置](https://github.com/yaoxieyoulei/mytv-android/blob/feature/ui/tv/build.gradle.kts)核实。伪装版本不按 `com.chinablue.tv` 自动匹配，以免影响同包名的其他应用。应用助手、通知为通用图标，仅登记名称别名，不推测包名。
