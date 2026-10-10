// worker（Cloudflare Pages）与本机 media gateway（Node）共享的常量单一来源。
// 两边各自实现校验逻辑（运行时不同：WebCrypto vs node:crypto），但白名单与
// cookie 契约必须一致，否则"改一漏一"直接断图或断鉴权。

// 图片远程主机白名单：法典原图由 worker 返回字节，其余来源沿用跳转或本机网关。
// 网关刻意额外允许 i.pximg.net（Pixiv 图床需本机 Referer 凭据）并校验 443 端口，
// worker 侧不放行——见 scripts/media-gateway.mjs 的 getValidatedSource。
export const CODEX_MEDIA_HOSTS = Object.freeze(['assets.quicktagcloud.com', 'novelai-strings.quicktagcloud.com', 'pub-a66b6b5ffa0d44a89eb7dd6fa1070b58.r2.dev', 'prompt-vault-gallery.pages.dev']);
export const MEDIA_REMOTE_HOSTS = Object.freeze(['ai-img.10118899.xyz', 'aitag.win', 'cdn.donmai.us', ...CODEX_MEDIA_HOSTS]);

// LAN 访问授权 cookie：worker 签发与校验、gateway 校验、前端随请求携带。
export const LAN_ACCESS_COOKIE = 'nai_lan_access';
