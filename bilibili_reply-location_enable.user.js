// ==UserScript==
// @name         bilibili reply-location enable
// @namespace    http://tampermonkey.net/
// @version      1.1.0
// @description  哔哩哔哩网页端视频评论显示ip属地
// @author       wyh00040
// @match         *://*.bilibili.com/*
// @icon         https://www.bilibili.com/favicon.ico?v=1
// @grant        none
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/wyh00040/bilibili-reply-location-enable/main/bilibili_reply-location_enable.meta.js
// @downloadURL  https://raw.githubusercontent.com/wyh00040/bilibili-reply-location-enable/main/bilibili_reply-location_enable.user.js
// ==/UserScript==

(function () {
    'use strict';

    const IP_ATTR = 'data-bili-ip-location';
    const ipStore = new Map(); // rpid -> location，作为兜底数据源

    // ============================================================
    // 第一部分：API 拦截（兜底）
    // ============================================================
    const regex_main_url = /\/\/api\.bilibili\.com\/x\/v2\/reply\/wbi\/main\?/;
    const regex_reply_url = /\/\/api\.bilibili\.com\/x\/v2\/reply\/reply\?/;
    const oldFetch = fetch;

    function extractReplies(data) {
        if (!data?.data) return;
        const roots = [
            ...(data.data.top_replies || []),
            ...(data.data.replies || []),
        ];
        const queue = [...roots];
        while (queue.length) {
            const item = queue.shift();
            if (item?.rpid && item?.reply_control?.location) {
                ipStore.set(String(item.rpid), item.reply_control.location);
            }
            if (item.replies) queue.push(...item.replies);
        }
    }

    window.fetch = function (...args) {
        const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
        return oldFetch.apply(this, args).then((response) => {
            if (url && (regex_main_url.test(url) || regex_reply_url.test(url))) {
                const clone = response.clone();
                clone.json().then(extractReplies).catch(() => {});
            }
            return response;
        });
    };

    // ============================================================
    // 第二部分：Hook bili-comment-action-buttons-renderer
    // 这是主评论和楼中楼共用的操作栏组件，this.data 直接带评论数据
    // ============================================================
    function createIpTag(location) {
        const div = document.createElement('div');
        div.setAttribute(IP_ATTR, '1');
        div.textContent = location;
        return div;
    }

    function injectIntoActionButtons(component) {
        const data = component.data;
        if (!data) return;

        const location = data.reply_control?.location || ipStore.get(String(data.rpid));
        if (!location) return;

        const root = component.shadowRoot;
        if (!root) return;

        // 已插入且内容一致，跳过
        const existing = root.querySelector(`[${IP_ATTR}]`);
        if (existing) {
            if (existing.textContent === location) return;
            existing.remove();
        }

        const pubdate = root.getElementById('pubdate');
        if (!pubdate) return;

        const tag = createIpTag(location);
        // 直接插在 #pubdate 后面，主评论和楼中楼都适用
        pubdate.insertAdjacentElement('afterend', tag);
    }

    const originalDefine = customElements.define.bind(customElements);
    customElements.define = function (name, constructor, options) {
        if (name === 'bili-comment-action-buttons-renderer') {
            const Original = constructor;

            class Patched extends Original {
                update(changedProperties) {
                    super.update(changedProperties);
                    // 微任务确保 Lit 本轮渲染完成
                    queueMicrotask(() => {
                        try {
                            injectIntoActionButtons(this);
                        } catch (e) { /* 静默失败，不影响页面 */ }
                    });
                }
                connectedCallback() {
                    super.connectedCallback?.();
                    queueMicrotask(() => {
                        try {
                            injectIntoActionButtons(this);
                        } catch (e) { /* ignore */ }
                    });
                }
            }

            return originalDefine(name, Patched, options);
        }
        return originalDefine(name, constructor, options);
    };
})();
