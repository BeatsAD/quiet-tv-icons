# Quiet TV 在线图标库

Quiet TV 定制应用图标。当前 61 款苹果风横向纯图标，每款提供 720×405 正式图与 320×180 缩略图，RGBA 8-bit PNG，保留 Alpha。

[在线浏览与按需下载](https://beatsad.github.io/quiet-tv-icons/)

客户端先读取小型签名目录，只请求可见缩略图和选中的正式图。已应用图标独立保存，离线可用。目录使用 RSA SHA-256 签名，图片按大小及 SHA-256 校验。应用名称和品牌标识用于识别对应应用，不代表官方出品或背书。

下载顺序与 Quiet TV 在线更新一致：ghfast.top、gh-proxy.com、v4.gh-proxy.org，然后 GitHub Pages、GitHub Raw。第三方镜像可能不可用，客户端会依次回退并验证内容。

`latest.signed.json` 为客户端目录，`catalog.json` 为网页目录，`public-key.der` 为公开验签密钥。图片路径 `images/apple/v1/` 不覆盖；新增或修订使用新版本路径并递增目录 revision。私钥只保存在维护者本地。

验证：`python3 tools/validate.py verify --root .`。CI 验证通过后才部署 GitHub Pages。
