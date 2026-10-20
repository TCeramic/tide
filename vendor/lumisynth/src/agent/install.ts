// src/agent/install.ts
// 启动时：把 agent 的写操作与失败记进「Agent」面板与「输出」，注册 WebMCP（浏览器支持时），
// 恢复本标签页之前的本地桥连接。
import { log } from '@/app/output';
import { recordAgentActivity, resumeAgentBridge } from './bridgeClient';
import { onAgentActivity } from './tools';
import { registerWebMcpTools } from './webmcp';

let installed = false;

export const installAgent = () => {
    if (installed) return;
    installed = true;
    onAgentActivity(entry => {
        recordAgentActivity(entry);
        log(`Agent · ${entry.tool}：${entry.summary}`, entry.ok ? 'info' : 'warn');
    });
    if (registerWebMcpTools()) log('已向浏览器注册 WebMCP 工具');
    void resumeAgentBridge();
};
