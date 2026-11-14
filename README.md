# Quiet TV 在线图标库

Quiet TV 定制应用图标。当前 61 款苹果风横向纯图标，每款提供 720×405 正式图与 320×180 缩略图，RGBA 8-bit PNG，保留 Alpha。

[在线浏览与按需下载](https://beatsad.github.io/quiet-tv-icons/)

客户端先读取小型签名目录，只请求可见缩略图和选中的正式图。已应用图标独立保存，离线可用。目录使用 RSA SHA-256 签名，图片按大小及 SHA-256 校验。应用名称和品牌标识用于识别对应应用，不代表官方出品或背书。

下载顺序与 Quiet TV 在线更新一致：ghfast.top、gh-proxy.com、v4.gh-proxy.org，然后 GitHub Pages、GitHub Raw。第三方镜像可能不可用，客户端会依次回退并验证内容。

`latest.signed.json` 为客户端目录，`catalog.json` 为网页目录，`public-key.der` 为公开验签密钥。图片路径 `images/apple/v1/` 不覆盖；新增或修订使用新版本路径并递增目录 revision。私钥只保存在维护者本地。

验证：`python3 tools/validate.py verify --root .`。CI 验证通过后才部署 GitHub Pages。

签名目录内的 `matches` 同步提供主题别名、核实包名和 `autoMatch` 确认状态，规则 revision 随规则内容变化递增，目录 revision 随任何发布变化递增。新主题必须一同登记匹配规则；身份待核对的项目使用 `autoMatch=false`，客户端不自动勾选。旧客户端可以读取同一目录并忽略新增字段，支持在线匹配规则的客户端优先使用已验签规则。

仅修改规则时使用 `tools/validate.py sign --catalog catalog.json --matches <规则JSON> --key <仓库外私钥> --revision <新目录版本> --output .`，继续复用不可变图片路径。图片、别名和包名记录应逐项核对，不将待核对身份改为自动确认。
