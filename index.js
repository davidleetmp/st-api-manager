import { extension_settings, renderExtensionTemplateAsync } from "/scripts/extensions.js";
import { saveSettingsDebounced } from "/script.js";
import { oai_settings, chat_completion_sources } from "/scripts/openai.js";
import { SECRET_KEYS, writeSecret } from "/scripts/secrets.js";
import { Popup, POPUP_TYPE, POPUP_RESULT } from "/scripts/popup.js";
import { SlashCommandParser } from "/scripts/slash-commands/SlashCommandParser.js";
import { SlashCommand } from "/scripts/slash-commands/SlashCommand.js";
import { SlashCommandArgument, SlashCommandNamedArgument, ARGUMENT_TYPE } from "/scripts/slash-commands/SlashCommandArgument.js";

const MODULE_NAME = "st-api-manager";
const TEMPLATE_PATH = `third-party/${MODULE_NAME}`;

const DEFAULT_SETTINGS = {
    profiles: [],
    activeProfileId: null,
    autoSyncToST: true,
};

const PRESETS = {
    deepseek: {
        name: "DeepSeek 官方",
        provider: "deepseek",
        apiUrl: "https://api.deepseek.com/v1",
        model: "deepseek-chat",
        stream: true,
        custom_include_body: "",
        custom_exclude_body: "",
        custom_include_headers: "",
        notes: "DeepSeek 官方 API 接口 (兼容 OpenAI 规范)"
    },
    openai: {
        name: "OpenAI 官方",
        provider: "openai",
        apiUrl: "https://api.openai.com/v1",
        model: "gpt-4o",
        stream: true,
        custom_include_body: "",
        custom_exclude_body: "",
        custom_include_headers: "",
        notes: "OpenAI 官方标准接口"
    },
    claude: {
        name: "Anthropic Claude",
        provider: "claude",
        apiUrl: "https://api.anthropic.com/v1",
        model: "claude-3-5-sonnet-20241022",
        stream: true,
        custom_include_body: "",
        custom_exclude_body: "",
        custom_include_headers: "",
        notes: "Anthropic Claude 官方接口"
    },
    gemini: {
        name: "Google Gemini",
        provider: "gemini",
        apiUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
        model: "gemini-2.5-flash",
        stream: true,
        custom_include_body: "",
        custom_exclude_body: "",
        custom_include_headers: "",
        notes: "Google Gemini OpenAI 兼容端点"
    },
    siliconflow: {
        name: "硅基流动 (SiliconFlow)",
        provider: "siliconflow",
        apiUrl: "https://api.siliconflow.cn/v1",
        model: "deepseek-ai/DeepSeek-V3",
        stream: true,
        custom_include_body: "",
        custom_exclude_body: "",
        custom_include_headers: "",
        notes: "硅基流动国内高并发托管平台"
    },
    openrouter: {
        name: "OpenRouter",
        provider: "openrouter",
        apiUrl: "https://openrouter.ai/api/v1",
        model: "deepseek/deepseek-r1",
        stream: true,
        custom_include_body: "",
        custom_exclude_body: "",
        custom_include_headers: "HTTP-Referer: https://sillytavern.app\nX-Title: SillyTavern",
        notes: "OpenRouter 聚合路由器"
    },
    ollama: {
        name: "Ollama (本地)",
        provider: "ollama",
        apiUrl: "http://127.0.0.1:11434/v1",
        model: "llama3:8b",
        stream: true,
        custom_include_body: "",
        custom_exclude_body: "",
        custom_include_headers: "",
        notes: "本地运行的 Ollama 服务"
    },
    custom: {
        name: "",
        provider: "custom",
        apiUrl: "",
        model: "",
        stream: true,
        custom_include_body: "",
        custom_exclude_body: "",
        custom_include_headers: "",
        notes: ""
    }
};

let currentFilter = "all";
let currentSearchQuery = "";
let isInitialized = false;

/**
 * Generate Unique UUID
 */
function generateId() {
    return 'prof_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 8);
}

/**
 * Get Settings helper
 */
function getSettings() {
    if (!extension_settings[MODULE_NAME]) {
        extension_settings[MODULE_NAME] = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    }
    return extension_settings[MODULE_NAME];
}

/**
 * Save Settings
 */
function persistSettings() {
    saveSettingsDebounced();
}

/**
 * Normalize and clean up API base URL
 */
function normalizeUrl(rawUrl) {
    if (!rawUrl) return "";
    let u = rawUrl.trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(u)) {
        u = 'https://' + u;
    }
    return u;
}

/**
 * Mask API Key for display
 */
function maskApiKey(key) {
    if (!key) return "未设置密钥";
    if (key.length <= 8) return "••••••••";
    return key.substring(0, 4) + "••••••••" + key.substring(key.length - 4);
}

/**
 * Parse YAML or JSON object (for include_body and include_headers)
 */
function parseYamlOrJsonObject(text) {
    if (!text || !text.trim()) return {};
    const trimmed = text.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        try { return JSON.parse(trimmed); } catch (e) {}
    }
    const result = {};
    const lines = trimmed.split('\n');
    lines.forEach(line => {
        const l = line.trim();
        if (!l || l.startsWith('#')) return;
        const colon = l.indexOf(':');
        if (colon > 0) {
            const key = l.substring(0, colon).trim();
            let val = l.substring(colon + 1).trim();
            if (/^-?\d+(\.\d+)?$/.test(val)) val = Number(val);
            else if (val.toLowerCase() === 'true') val = true;
            else if (val.toLowerCase() === 'false') val = false;
            else if (val.toLowerCase() === 'null') val = null;
            else if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                val = val.slice(1, -1);
            }
            if (key) result[key] = val;
        }
    });
    return result;
}

/**
 * Parse YAML list (for exclude_body)
 */
function parseYamlList(text) {
    if (!text || !text.trim()) return [];
    const trimmed = text.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        try { return JSON.parse(trimmed); } catch (e) {}
    }
    const list = [];
    const lines = trimmed.split('\n');
    lines.forEach(line => {
        const l = line.trim();
        if (!l || l.startsWith('#')) return;
        if (l.startsWith('-')) {
            list.push(l.substring(1).trim());
        } else {
            list.push(l);
        }
    });
    return list;
}

/**
 * Get currently active profile
 */
function getActiveProfile() {
    const settings = getSettings();
    if (!settings.activeProfileId || !Array.isArray(settings.profiles)) return null;
    return settings.profiles.find(p => p.id === settings.activeProfileId) || null;
}

/**
 * Detect provider from API URL or Model name
 */
function guessProvider(url, model) {
    const u = (url || '').toLowerCase();
    const m = (model || '').toLowerCase();
    if (u.includes('deepseek') || m.includes('deepseek')) return 'deepseek';
    if (u.includes('siliconflow')) return 'siliconflow';
    if (u.includes('openrouter')) return 'openrouter';
    if (u.includes('anthropic') || m.includes('claude')) return 'claude';
    if (u.includes('generativelanguage.googleapis.com') || m.includes('gemini')) return 'gemini';
    if (u.includes('localhost') || u.includes('127.0.0.1') || u.includes(':11434') || m.includes('llama')) return 'ollama';
    if (u.includes('openai.com') || m.includes('gpt')) return 'openai';
    return 'custom';
}

/**
 * Generate a smart, human-friendly profile name based on provider, model, and endpoint
 */
function generateSmartProfileName(provider, model, url) {
    const pNameMap = {
        'deepseek': 'DeepSeek',
        'openai': 'OpenAI',
        'claude': 'Claude',
        'gemini': 'Gemini',
        'makersuite': 'Gemini',
        'siliconflow': '硅基流动',
        'openrouter': 'OpenRouter',
        'ollama': 'Ollama (本地)',
        'custom': 'Custom API'
    };
    const pName = pNameMap[provider] || (provider ? provider.toUpperCase() : 'API');
    
    if (model && model.trim()) {
        return `${pName} (${model.trim()})`;
    }
    if (url && url.trim()) {
        try {
            const host = new URL(url.trim()).hostname;
            return `${pName} - ${host}`;
        } catch (e) {}
    }
    return `${pName} 配置档案`;
}

/**
 * Read current active SillyTavern connection settings directly from DOM and internal variables
 */
function readCurrentSillyTavernConnection() {
    const mainApi = $('#main_api').val() || 'openai';
    const source = $('#chat_completion_source').val() || 'custom';

    let url = '';
    let key = '';
    let model = '';
    let provider = 'custom';

    // 1. Map SillyTavern chat_completion_source to ST-API-Manager provider
    if (source === 'deepseek') {
        provider = 'deepseek';
        url = $('#openai_reverse_proxy').val() || 'https://api.deepseek.com/v1';
        key = $('#api_key_deepseek').val() || $('#api_key_openai').val() || $('#api_key_custom').val() || '';
        model = $('#model_deepseek_select').val() || $('#model_openai_select').val() || 'deepseek-chat';
    } else if (source === 'siliconflow') {
        provider = 'siliconflow';
        url = 'https://api.siliconflow.cn/v1';
        key = $('#api_key_siliconflow').val() || $('#api_key_openai').val() || $('#api_key_custom').val() || '';
        model = $('#model_siliconflow_select').val() || $('#model_openai_select').val() || '';
    } else if (source === 'claude') {
        provider = 'claude';
        url = $('#claude_reverse_proxy').val() || 'https://api.anthropic.com/v1';
        key = $('#api_key_claude').val() || $('#api_key_openai').val() || '';
        model = $('#model_claude_select').val() || 'claude-3-5-sonnet-20241022';
    } else if (source === 'makersuite') {
        provider = 'gemini';
        url = $('#makersuite_reverse_proxy').val() || 'https://generativelanguage.googleapis.com/v1beta/openai/';
        key = $('#api_key_makersuite').val() || $('#api_key_openai').val() || '';
        model = $('#model_makersuite_select').val() || 'gemini-2.5-flash';
    } else if (source === 'openrouter') {
        provider = 'openrouter';
        url = 'https://openrouter.ai/api/v1';
        key = $('#api_key_openrouter').val() || $('#api_key_openai').val() || '';
        model = $('#model_openrouter_select').val() || '';
    } else if (source === 'openai') {
        provider = 'openai';
        url = $('#openai_reverse_proxy').val() || 'https://api.openai.com/v1';
        key = $('#api_key_openai').val() || $('#openai_proxy_password').val() || $('#api_key_custom').val() || '';
        model = $('#model_openai_select').val() || 'gpt-4o';
    } else {
        provider = 'custom';
        url = $('#custom_api_url_text').val() ||
              $('#openai_reverse_proxy').val() ||
              $('#custom_url').val() ||
              $('#custom_endpoint_url').val() ||
              '';
        key = $('#api_key_custom').val() ||
              $('#api_key_openai').val() ||
              $('#openai_proxy_password').val() ||
              '';
        model = $('#custom_model_id').val() ||
                $('#model_custom_select').val() ||
                $('#model_openai_select').val() ||
                '';
        
        if (url) {
            const guessed = guessProvider(url, model);
            if (guessed !== 'custom') provider = guessed;
        }
    }

    // Streaming state
    const isStream = $('#stream_toggle').prop('checked') !== false;

    // Additional Parameters
    const incBody = $('#custom_include_body').val() || '';
    const excBody = $('#custom_exclude_body').val() || '';
    const incHeaders = $('#custom_include_headers').val() || '';

    return {
        url: normalizeUrl(url),
        key,
        model,
        provider,
        source,
        mainApi,
        stream: isStream,
        incBody,
        excBody,
        incHeaders
    };
}

/**
 * Import currently active API settings from SillyTavern's connection panel
 */
function importCurrentMainApi() {
    const stConn = readCurrentSillyTavernConnection();

    if (!stConn.url && !stConn.model && !stConn.key) {
        toastr.warning("未在酒馆连接设置中检测到已配置的 API 网址、密钥或模型，请在酒馆连接面板中检查！");
        return;
    }

    const autoName = generateSmartProfileName(stConn.provider, stConn.model, stConn.url);

    const importedProfile = {
        id: generateId(),
        name: autoName,
        provider: stConn.provider,
        apiUrl: stConn.url,
        apiKey: stConn.key,
        model: stConn.model,
        stream: stConn.stream,
        custom_include_body: stConn.incBody,
        custom_exclude_body: stConn.excBody,
        custom_include_headers: stConn.incHeaders,
        notes: `于 ${new Date().toLocaleDateString()} 从酒馆主连接（来源: ${stConn.source}）一键导入`,
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now()
    };

    openEditModal(importedProfile);
    toastr.info(`已读取当前酒馆主连接：【${autoName}】（来源: ${stConn.source} | 流式: ${stConn.stream ? '开' : '关'}），请确认并保存！`);
}

/**
 * Sync active profile to SillyTavern UI inputs and connection settings
 */
async function syncProfileToSillyTavern(profile) {
    if (!profile) return;
    try {
        const cleanUrl = normalizeUrl(profile.apiUrl);
        const p = (profile.provider || 'custom').toLowerCase();

        // 1. Ensure main_api is set to 'openai' (Chat Completion mode)
        const $mainApi = $('#main_api');
        if ($mainApi.length) {
            $mainApi.val('openai').trigger('input').trigger('change');
        }
        if (typeof window !== 'undefined' && window.main_api !== undefined) {
            window.main_api = 'openai';
        }

        // 2. Map provider to SillyTavern chat_completion_source
        let targetSource = 'custom';
        if (p === 'openai') {
            targetSource = (!cleanUrl || cleanUrl.includes('api.openai.com')) ? 'openai' : 'custom';
        } else if (p === 'claude') {
            targetSource = 'claude';
        } else if (p === 'gemini' || p === 'makersuite') {
            targetSource = cleanUrl ? 'custom' : 'makersuite';
        } else if (p === 'openrouter') {
            targetSource = 'openrouter';
        } else if (p === 'siliconflow') {
            targetSource = 'siliconflow';
        } else if (p === 'deepseek') {
            targetSource = 'deepseek';
        } else {
            targetSource = 'custom';
        }

        const $sourceSelect = $('#chat_completion_source');
        if ($sourceSelect.length) {
            $sourceSelect.val(targetSource).trigger('input').trigger('change');
        }
        if (typeof oai_settings !== 'undefined' && oai_settings) {
            oai_settings.chat_completion_source = targetSource;
        }

        // 3. Set Endpoint URLs in all matching fields & oai_settings
        $('#custom_api_url_text').val(cleanUrl).trigger('input').trigger('change');
        $('#openai_reverse_proxy').val(cleanUrl).trigger('input').trigger('change');
        if ($('#claude_reverse_proxy').length) $('#claude_reverse_proxy').val(cleanUrl).trigger('input').trigger('change');
        if ($('#makersuite_reverse_proxy').length) $('#makersuite_reverse_proxy').val(cleanUrl).trigger('input').trigger('change');
        
        if (typeof oai_settings !== 'undefined' && oai_settings) {
            oai_settings.custom_url = cleanUrl;
            oai_settings.reverse_proxy = cleanUrl;
        }

        // 4. Set API Keys in all matching fields, oai_settings & ST secrets store
        if (profile.apiKey !== undefined) {
            const k = profile.apiKey.trim();
            $('#api_key_custom').val(k).trigger('input').trigger('change');
            $('#api_key_openai').val(k).trigger('input').trigger('change');
            $('#openai_proxy_password').val(k).trigger('input').trigger('change');
            if ($('#api_key_claude').length) $('#api_key_claude').val(k).trigger('input').trigger('change');
            if ($('#api_key_makersuite').length) $('#api_key_makersuite').val(k).trigger('input').trigger('change');
            if ($('#api_key_openrouter').length) $('#api_key_openrouter').val(k).trigger('input').trigger('change');
            if ($('#api_key_siliconflow').length) $('#api_key_siliconflow').val(k).trigger('input').trigger('change');
            if ($('#api_key_deepseek').length) $('#api_key_deepseek').val(k).trigger('input').trigger('change');

            try {
                if (typeof writeSecret === 'function' && typeof SECRET_KEYS !== 'undefined') {
                    if (SECRET_KEYS.CUSTOM) await writeSecret(SECRET_KEYS.CUSTOM, k);
                    if (SECRET_KEYS.OPENAI) await writeSecret(SECRET_KEYS.OPENAI, k);
                    if (targetSource === 'deepseek' && SECRET_KEYS.DEEPSEEK) await writeSecret(SECRET_KEYS.DEEPSEEK, k);
                    if (targetSource === 'siliconflow' && SECRET_KEYS.SILICONFLOW) await writeSecret(SECRET_KEYS.SILICONFLOW, k);
                    if (targetSource === 'openrouter' && SECRET_KEYS.OPENROUTER) await writeSecret(SECRET_KEYS.OPENROUTER, k);
                    if (targetSource === 'claude' && SECRET_KEYS.CLAUDE) await writeSecret(SECRET_KEYS.CLAUDE, k);
                    if (targetSource === 'makersuite' && SECRET_KEYS.MAKERSUITE) await writeSecret(SECRET_KEYS.MAKERSUITE, k);
                }
            } catch (secErr) {
                console.warn('[' + MODULE_NAME + '] writeSecret warning:', secErr);
            }
        }

        // 5. Set Model Name in all matching model fields and internal settings
        if (profile.model) {
            const m = profile.model.trim();
            $('#custom_model_id').val(m).trigger('input').trigger('change');
            
            const modelSelects = [
                '#model_custom_select',
                '#model_openai_select',
                '#model_deepseek_select',
                '#model_siliconflow_select',
                '#model_openrouter_select',
                '#model_claude_select',
                '#model_makersuite_select',
                '#model_google_select',
                '#model_groq_select',
                '#model_chutes_select',
                '#model_xai_select',
                '#model_aimlapi_select'
            ];

            modelSelects.forEach(selId => {
                const $sel = $(selId);
                if ($sel.length) {
                    if ($sel.find('option[value="' + CSS.escape(m) + '"]').length === 0) {
                        $sel.append('<option value="' + escapeHtml(m) + '">' + escapeHtml(m) + '</option>');
                    }
                    $sel.val(m).trigger('input').trigger('change');
                }
            });

            if (typeof oai_settings !== 'undefined' && oai_settings) {
                oai_settings.custom_model = m;
                oai_settings.openai_model = m;
                oai_settings.deepseek_model = m;
                oai_settings.siliconflow_model = m;
                oai_settings.openrouter_model = m;
                oai_settings.claude_model = m;
                oai_settings.google_model = m;
            }
        }

        // 6. Set Streaming Toggle State
        const isStream = (profile.stream !== false);
        $('#stream_toggle').prop('checked', isStream).trigger('input').trigger('change');
        if (typeof oai_settings !== 'undefined' && oai_settings) {
            oai_settings.stream_openai = isStream;
        }

        // 7. Set Additional Request Parameters
        $('#custom_include_body').val(profile.custom_include_body || '').trigger('input').trigger('change');
        $('#custom_exclude_body').val(profile.custom_exclude_body || '').trigger('input').trigger('change');
        $('#custom_include_headers').val(profile.custom_include_headers || '').trigger('input').trigger('change');

        // 8. Save settings to disk and trigger connect
        saveSettingsDebounced();
        
        // Trigger both OpenAI connect button and standard API connect button
        setTimeout(() => {
            if ($('#api_button_openai').length) {
                $('#api_button_openai').trigger('click');
            } else if ($('#api_button').length) {
                $('#api_button').trigger('click');
            }
        }, 150);

        toastr.success('已将【' + profile.name + '】（来源: ' + targetSource + ' | 模型: ' + profile.model + ' | 流式: ' + (isStream ? '开' : '关') + '）同步并连接到酒馆！');
    } catch (err) {
        console.error('[' + MODULE_NAME + '] sync to ST error:', err);
        toastr.error('同步至酒馆失败: ' + err.message);
    }
}

function setActiveProfile(id) {
    const settings = getSettings();
    const target = (settings.profiles || []).find(p => p.id === id);
    if (!target) return;

    settings.activeProfileId = id;
    settings.profiles.forEach(p => {
        p.isActive = (p.id === id);
    });

    persistSettings();
    renderProfilesList();
    updateActiveBanner();

    if (settings.autoSyncToST !== false) {
        syncProfileToSillyTavern(target);
    }
}

/**
 * Real Model Inference Test (Calls Chat Completions to verify model functionality and inspect actual output)
 */
async function testApiConnection(profile) {
    const startTime = performance.now();
    try {
        const cleanUrl = normalizeUrl(profile.apiUrl);
        if (!cleanUrl) {
            return { success: false, message: "API 基础网址为空", latency: 0 };
        }
        if (!profile.model || !profile.model.trim()) {
            return { success: false, message: "请先填写或选择要测试的模型名称 (Model ID)", latency: 0 };
        }

        const headers = { "Content-Type": "application/json" };
        if (profile.apiKey) {
            headers["Authorization"] = `Bearer ${profile.apiKey}`;
        }
        if (profile.custom_include_headers) {
            try {
                const parsed = parseYamlOrJsonObject(profile.custom_include_headers);
                Object.assign(headers, parsed);
            } catch (e) {
                console.warn("Invalid custom headers", e);
            }
        }

        const bodyPayload = {
            model: profile.model.trim(),
            messages: [
                { role: "user", content: "Hi! Please reply with exactly one word: OK" }
            ],
            max_tokens: 32,
            temperature: 0.1,
            stream: false
        };

        if (profile.custom_include_body) {
            try {
                const inc = parseYamlOrJsonObject(profile.custom_include_body);
                Object.assign(bodyPayload, inc);
            } catch (e) {}
        }

        if (profile.custom_exclude_body) {
            try {
                const exc = parseYamlList(profile.custom_exclude_body);
                exc.forEach(k => {
                    delete bodyPayload[k];
                });
            } catch (e) {}
        }

        const isNativeClaude = (profile.provider === 'claude' && cleanUrl.includes('api.anthropic.com'));
        let targetEndpoint = `${cleanUrl}/chat/completions`;
        
        if (isNativeClaude) {
            targetEndpoint = `${cleanUrl}/messages`;
            headers['x-api-key'] = profile.apiKey;
            headers['anthropic-version'] = '2023-06-01';
            delete headers['Authorization'];
            bodyPayload.messages = [{ role: 'user', content: 'Hi, reply OK.' }];
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 20000);

        let res;
        try {
            res = await fetch(targetEndpoint, {
                method: "POST",
                headers,
                body: JSON.stringify(bodyPayload),
                signal: controller.signal
            });
        } catch (fetchErr) {
            clearTimeout(timeoutId);
            return {
                success: false,
                message: `请求失败 / 网络超时 (${fetchErr.message})`,
                latency: Math.round(performance.now() - startTime),
                status: 0
            };
        }
        clearTimeout(timeoutId);

        const latency = Math.round(performance.now() - startTime);

        if (res.ok) {
            let replyText = "";
            try {
                const data = await res.json();
                if (data.choices?.[0]?.message?.content) {
                    replyText = data.choices[0].message.content;
                } else if (data.choices?.[0]?.text) {
                    replyText = data.choices[0].text;
                } else if (data.content?.[0]?.text) {
                    replyText = data.content[0].text;
                } else if (data.message?.content) {
                    replyText = data.message.content;
                } else if (data.response) {
                    replyText = data.response;
                }
            } catch (e) {}

            const cleanReply = replyText.trim().replace(/\r?\n+/g, ' ');
            const displaySnippet = cleanReply ? `「${cleanReply.slice(0, 40)}${cleanReply.length > 40 ? '...' : ''}」` : '(空回复/首Token)';

            return {
                success: true,
                message: `模型可用！响应耗时 ${latency}ms | 模型实际返回: ${displaySnippet}`,
                latency,
                status: res.status
            };
        } else {
            let errorMsg = `HTTP ${res.status} ${res.statusText}`;
            try {
                const errData = await res.json();
                if (errData.error?.message) {
                    errorMsg += ` - ${errData.error.message}`;
                } else if (errData.message) {
                    errorMsg += ` - ${errData.message}`;
                }
            } catch (e) {
                const txt = await res.text().catch(() => "");
                if (txt) errorMsg += ` - ${txt.slice(0, 120)}`;
            }

            return {
                success: false,
                message: `模型调用异常: ${errorMsg}`,
                latency,
                status: res.status
            };
        }
    } catch (err) {
        const latency = Math.round(performance.now() - startTime);
        return {
            success: false,
            message: `测试执行异常: ${err.message}`,
            latency,
            status: 0
        };
    }
}

/**
 * Fetch remote models from /models endpoint
 */
async function fetchRemoteModels(apiUrl, apiKey, customHeaders) {
    if (!apiUrl) throw new Error("请先填写 API 基础网址");
    const cleanUrl = normalizeUrl(apiUrl);
    const headers = { "Content-Type": "application/json" };
    if (apiKey) {
        headers["Authorization"] = `Bearer ${apiKey}`;
    }
    if (customHeaders) {
        try {
            const parsed = parseYamlOrJsonObject(customHeaders);
            Object.assign(headers, parsed);
        } catch (e) {
            console.warn("Invalid custom headers", e);
        }
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

    const response = await fetch(`${cleanUrl}/models`, {
        method: "GET",
        headers,
        signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
        throw new Error(`获取模型失败 (HTTP ${response.status}: ${response.statusText})`);
    }

    const data = await response.json();
    let modelList = [];
    if (Array.isArray(data.data)) {
        modelList = data.data.map(m => m.id || m.name || m);
    } else if (Array.isArray(data.models)) {
        modelList = data.models.map(m => m.name || m.id || m);
    } else if (Array.isArray(data)) {
        modelList = data.map(m => m.id || m.name || m);
    }

    return modelList.filter(Boolean);
}

/**
 * Render the list of profile cards
 */
function renderProfilesList() {
    const settings = getSettings();
    const container = $("#st_api_list_container");
    const emptyState = $("#st_api_empty_state");
    const countAll = $("#st_api_count_all");
    
    if (!container.length) return;
    container.empty();

    let profiles = settings.profiles || [];
    if (countAll.length) countAll.text(profiles.length);

    // Apply Filter
    if (currentFilter !== "all") {
        profiles = profiles.filter(p => p.provider === currentFilter);
    }

    // Apply Search
    if (currentSearchQuery.trim()) {
        const q = currentSearchQuery.trim().toLowerCase();
        profiles = profiles.filter(p => 
            (p.name && p.name.toLowerCase().includes(q)) ||
            (p.apiUrl && p.apiUrl.toLowerCase().includes(q)) ||
            (p.model && p.model.toLowerCase().includes(q)) ||
            (p.notes && p.notes.toLowerCase().includes(q))
        );
    }

    if (profiles.length === 0) {
        emptyState.show();
        return;
    }
    emptyState.hide();

    profiles.forEach(profile => {
        const isActive = (profile.id === settings.activeProfileId);
        const providerClass = `st-api-tag-${profile.provider || 'custom'}`;
        const providerLabel = (profile.provider || 'custom').toUpperCase();

        const card = $(`
            <div class="st-api-card ${isActive ? 'st-api-card-active' : ''}" data-id="${profile.id}">
                <div class="st-api-card-header">
                    <div class="st-api-card-title-group">
                        <span class="st-api-card-name">${escapeHtml(profile.name || '未命名 API')}</span>
                        <span class="st-api-tag ${providerClass}">${providerLabel}</span>
                        ${isActive ? '<span class="st-api-pill-badge st-api-pill-active"><span class="st-api-status-dot"></span> 运行中</span>' : ''}
                    </div>
                </div>

                <div class="st-api-card-body">
                    <div class="st-api-card-row">
                        <i class="fa-solid fa-link" title="Endpoint URL"></i>
                        <span class="st-api-code-text">${escapeHtml(profile.apiUrl || '-')}</span>
                    </div>
                    <div class="st-api-card-row">
                        <i class="fa-solid fa-microchip" title="Model"></i>
                        <span class="st-api-card-model-name">${escapeHtml(profile.model || '-')}</span>
                    </div>
                    <div class="st-api-card-row">
                        <i class="fa-solid fa-key" title="API Key"></i>
                        <div class="st-api-key-wrapper">
                            <span class="st-api-code-text">${maskApiKey(profile.apiKey)}</span>
                            <button type="button" class="st-api-mini-copy-btn st-api-btn-copy-key" title="复制密钥">
                                <i class="fa-regular fa-copy"></i>
                            </button>
                        </div>
                    </div>
                    
                    <div class="st-api-card-badges">
                        ${profile.stream !== false ? '<span class="st-api-param-pill" title="流式传输开启"><i class="fa-solid fa-bolt" style="color:#38bdf8;"></i> 流式</span>' : '<span class="st-api-param-pill" title="非流式传输"><i class="fa-solid fa-ban" style="color:#94a3b8;"></i> 非流式</span>'}
                        ${profile.custom_include_body ? '<span class="st-api-param-pill" title="已配置包含主体参数"><i class="fa-solid fa-plus-circle" style="color:#34d399;"></i> 包含主体</span>' : ''}
                        ${profile.custom_exclude_body ? '<span class="st-api-param-pill" title="已配置排除主体参数"><i class="fa-solid fa-minus-circle" style="color:#f87171;"></i> 排除主体</span>' : ''}
                        ${profile.custom_include_headers ? '<span class="st-api-param-pill" title="已配置附加请求标头"><i class="fa-solid fa-network-wired" style="color:#60a5fa;"></i> 附加标头</span>' : ''}
                    </div>

                    ${profile.notes ? `<div class="st-api-card-notes">${escapeHtml(profile.notes)}</div>` : ''}
                </div>

                <div class="st-api-card-footer">
                    <div class="st-api-card-actions-left">
                        ${isActive ? `
                            <button type="button" class="st-api-btn st-api-btn-card-active" disabled>
                                <i class="fa-solid fa-circle-check"></i>
                                <span>当前生效</span>
                            </button>
                        ` : `
                            <button type="button" class="st-api-btn st-api-btn-card-activate" title="设为当前生效 API 并应用到酒馆">
                                <i class="fa-solid fa-bolt"></i>
                                <span>激活</span>
                            </button>
                        `}
                        <button type="button" class="st-api-btn st-api-btn-card-tool st-api-btn-test-card" title="发送测试请求，验证模型是否有效及实际返回">
                            <i class="fa-solid fa-play"></i>
                            <span>测试模型</span>
                        </button>
                    </div>

                    <div class="st-api-card-actions-right">
                        <button type="button" class="st-api-btn st-api-btn-card-tool st-api-btn-clone-card" title="克隆复制此配置">
                            <i class="fa-solid fa-clone"></i>
                        </button>
                        <button type="button" class="st-api-btn st-api-btn-card-tool st-api-btn-edit-card" title="修改编辑">
                            <i class="fa-solid fa-pen-to-square"></i>
                        </button>
                        <button type="button" class="st-api-btn st-api-btn-card-tool st-api-btn-delete-card" title="删除">
                            <i class="fa-solid fa-trash" style="color:#f87171;"></i>
                        </button>
                    </div>
                </div>
            </div>
        `);

        // Event bindings for card buttons
        card.find(".st-api-btn-card-activate").on("click", () => {
            setActiveProfile(profile.id);
        });

        card.find(".st-api-btn-test-card").on("click", async function() {
            const btn = $(this);
            btn.prop("disabled", true).html('<i class="fa-solid fa-spinner fa-spin"></i> <span>推理中...</span>');
            const result = await testApiConnection(profile);
            btn.prop("disabled", false).html('<i class="fa-solid fa-play"></i> <span>测试模型</span>');
            
            if (result.success) {
                toastr.success(`[${profile.name}] ${result.message}`, "模型测试通过", { timeOut: 6000 });
            } else {
                toastr.error(`[${profile.name}] ${result.message}`, "模型测试失败", { timeOut: 8000 });
            }
        });

        card.find(".st-api-btn-copy-key").on("click", () => {
            if (!profile.apiKey) {
                toastr.warning("未配置 API 密钥");
                return;
            }
            navigator.clipboard.writeText(profile.apiKey).then(() => {
                toastr.info("已复制 API 密钥到剪贴板");
            }).catch(() => {
                toastr.info(`密钥: ${profile.apiKey}`);
            });
        });

        card.find(".st-api-btn-clone-card").on("click", () => {
            const clone = JSON.parse(JSON.stringify(profile));
            clone.id = generateId();
            clone.name = `${profile.name} (副本)`;
            clone.isActive = false;
            clone.createdAt = Date.now();
            settings.profiles.push(clone);
            persistSettings();
            toastr.success(`已克隆 API 配置：${clone.name}`);
            renderProfilesList();
        });

        card.find(".st-api-btn-edit-card").on("click", () => {
            openEditModal(profile);
        });

        card.find(".st-api-btn-delete-card").on("click", async () => {
            if (confirm(`确认删除 API 配置【${profile.name}】吗？`)) {
                settings.profiles = settings.profiles.filter(p => p.id !== profile.id);
                if (settings.activeProfileId === profile.id) {
                    settings.activeProfileId = settings.profiles.length > 0 ? settings.profiles[0].id : null;
                }
                persistSettings();
                toastr.info(`已删除配置【${profile.name}】`);
                renderProfilesList();
                updateActiveBanner();
            }
        });

        container.append(card);
    });
}

/**
 * Update top active profile banner
 */
function updateActiveBanner() {
    const active = getActiveProfile();
    const banner = $("#st_api_active_banner");
    const topBadge = $("#st_api_active_badge");
    const topBadgeName = $("#st_api_active_name");

    if (!active) {
        if (banner.length) banner.hide();
        if (topBadge.length) topBadge.hide();
        return;
    }

    if (topBadgeName.length) topBadgeName.text(active.name);
    if (topBadge.length) topBadge.show();

    if (banner.length) {
        $("#st_api_banner_name").text(active.name);
        $("#st_api_banner_url").text(active.apiUrl || '-');
        $("#st_api_banner_model").text(active.model || '-');
        
        const provTag = $("#st_api_banner_provider");
        provTag.attr("class", `st-api-tag st-api-tag-${active.provider || 'custom'}`);
        provTag.text((active.provider || 'custom').toUpperCase());

        banner.show();
    }
}

/**
 * Open Modal to Add or Edit Profile
 */
async function openEditModal(existingProfile = null) {
    const modalHtml = $(await renderExtensionTemplateAsync(TEMPLATE_PATH, "modal"));
    
    modalHtml.find("#st_api_modal_heading").text(existingProfile ? (existingProfile.id ? "编辑 API 配置档案" : "保存导入的主连接档案") : "新增 API 配置档案");

    if (existingProfile) {
        modalHtml.find("#st_api_form_id").val(existingProfile.id || "");
        modalHtml.find("#st_api_form_name").val(existingProfile.name || "");
        modalHtml.find("#st_api_form_provider").val(existingProfile.provider || "custom");
        modalHtml.find("#st_api_form_url").val(existingProfile.apiUrl || "");
        modalHtml.find("#st_api_form_key").val(existingProfile.apiKey || "");
        modalHtml.find("#st_api_form_model").val(existingProfile.model || "");
        modalHtml.find("#st_api_form_stream").prop("checked", existingProfile.stream !== false);
        modalHtml.find("#st_api_form_include_body").val(existingProfile.custom_include_body || "");
        modalHtml.find("#st_api_form_exclude_body").val(existingProfile.custom_exclude_body || "");
        modalHtml.find("#st_api_form_include_headers").val(existingProfile.custom_include_headers || "");
        modalHtml.find("#st_api_form_notes").val(existingProfile.notes || "");
        modalHtml.find("#st_api_form_set_active").prop("checked", existingProfile.isActive !== false);
    } else {
        modalHtml.find("#st_api_form_set_active").prop("checked", true);
        modalHtml.find("#st_api_form_stream").prop("checked", true);
    }

    modalHtml.find(".st-api-preset-pill").on("click", function() {
        const presetKey = $(this).data("preset");
        const preset = PRESETS[presetKey];
        if (preset) {
            if (preset.name && !modalHtml.find("#st_api_form_name").val()) {
                modalHtml.find("#st_api_form_name").val(preset.name);
            }
            modalHtml.find("#st_api_form_provider").val(preset.provider);
            modalHtml.find("#st_api_form_url").val(preset.apiUrl);
            modalHtml.find("#st_api_form_model").val(preset.model);
            modalHtml.find("#st_api_form_stream").prop("checked", preset.stream !== false);
            if (preset.custom_include_body) modalHtml.find("#st_api_form_include_body").val(preset.custom_include_body);
            if (preset.custom_exclude_body) modalHtml.find("#st_api_form_exclude_body").val(preset.custom_exclude_body);
            if (preset.custom_include_headers) modalHtml.find("#st_api_form_include_headers").val(preset.custom_include_headers);
            if (preset.notes && !modalHtml.find("#st_api_form_notes").val()) {
                modalHtml.find("#st_api_form_notes").val(preset.notes);
            }
            toastr.info(`已套用【${preset.name || presetKey}】配置模板`);
        }
    });

    modalHtml.find("#st_api_btn_toggle_key").on("click", function() {
        const keyInput = modalHtml.find("#st_api_form_key");
        const icon = $(this).find("i");
        if (keyInput.attr("type") === "password") {
            keyInput.attr("type", "text");
            icon.removeClass("fa-eye").addClass("fa-eye-slash");
        } else {
            keyInput.attr("type", "password");
            icon.removeClass("fa-eye-slash").addClass("fa-eye");
        }
    });

    modalHtml.find("#st_api_btn_paste_key").on("click", async () => {
        try {
            const text = await navigator.clipboard.readText();
            if (text) {
                modalHtml.find("#st_api_form_key").val(text.trim());
                toastr.info("已从剪贴板粘贴密钥");
            }
        } catch (e) {
            toastr.warning("请手动在输入框粘贴密钥");
        }
    });

    modalHtml.find("#st_api_btn_normalize_url").on("click", () => {
        const urlInput = modalHtml.find("#st_api_form_url");
        urlInput.val(normalizeUrl(urlInput.val()));
        toastr.info("已规范化 API 网址格式");
    });

    let loadedModelsList = [];

    function renderModelSelectOptions(filterText = '') {
        const select = modalHtml.find("#st_api_model_select");
        select.empty();

        const currentVal = modalHtml.find("#st_api_form_model").val().trim();
        const q = filterText.toLowerCase().trim();
        const filtered = q ? loadedModelsList.filter(m => m.toLowerCase().includes(q)) : loadedModelsList;

        if (filtered.length === 0) {
            select.append(`<option disabled style="color:#94a3b8; font-style:italic;">-- 无匹配的模型名称 --</option>`);
            return;
        }

        filtered.forEach(m => {
            const isSelected = (m === currentVal);
            const opt = $(`<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`);
            if (isSelected) opt.prop("selected", true);
            select.append(opt);
        });
    }

    // Auto-collapse dropdown when an item is selected
    modalHtml.find("#st_api_model_select").on("change click", function() {
        const chosen = $(this).val();
        if (chosen) {
            modalHtml.find("#st_api_form_model").val(chosen);
            modalHtml.find("#st_api_model_select_container").slideUp(180);
            modalHtml.find("#st_api_model_count_text").text(`已选用: ${chosen} (点击重选)`);
        }
    });

    // Toggle dropdown on badge click
    modalHtml.find("#st_api_model_count_badge").on("click", function() {
        if (loadedModelsList.length > 0) {
            modalHtml.find("#st_api_model_select_container").slideToggle(180);
        }
    });

    modalHtml.find("#st_api_model_filter_input").on("input", function() {
        renderModelSelectOptions($(this).val());
    });

    modalHtml.find("#st_api_btn_fetch_models").on("click", async function() {
        const btn = $(this);
        const url = modalHtml.find("#st_api_form_url").val();
        const key = modalHtml.find("#st_api_form_key").val();
        const headersStr = modalHtml.find("#st_api_form_include_headers").val();

        if (!url) {
            toastr.warning("请先填写 API 基础网址");
            return;
        }

        btn.prop("disabled", true).find("#st_api_fetch_btn_text").text("拉取中...");
        try {
            const models = await fetchRemoteModels(url, key, headersStr);
            loadedModelsList = models;

            if (models.length > 0) {
                const badge = modalHtml.find("#st_api_model_count_badge");
                modalHtml.find("#st_api_model_count_text").text(`共拉取到 ${models.length} 个模型 (点击展开/选用)`);
                badge.show();

                modalHtml.find("#st_api_model_select_container").slideDown(150);
                renderModelSelectOptions(modalHtml.find("#st_api_model_filter_input").val());

                if (!modalHtml.find("#st_api_form_model").val()) {
                    modalHtml.find("#st_api_form_model").val(models[0]);
                }
                toastr.success(`成功拉取 ${models.length} 个模型，点击即可自动填入并收起！`);
            } else {
                toastr.info("端点响应成功，但未解析到可用模型列表");
            }
        } catch (err) {
            toastr.error(`拉取模型失败: ${err.message}`);
        } finally {
            btn.prop("disabled", false).find("#st_api_fetch_btn_text").text("拉取模型列表");
        }
    });

    modalHtml.find("#st_api_btn_test_modal").on("click", async function() {
        const resultBox = modalHtml.find("#st_api_modal_test_result");
        const tempProfile = {
            apiUrl: modalHtml.find("#st_api_form_url").val(),
            apiKey: modalHtml.find("#st_api_form_key").val(),
            model: modalHtml.find("#st_api_form_model").val(),
            provider: modalHtml.find("#st_api_form_provider").val(),
            stream: modalHtml.find("#st_api_form_stream").prop("checked") !== false,
            custom_include_body: modalHtml.find("#st_api_form_include_body").val(),
            custom_exclude_body: modalHtml.find("#st_api_form_exclude_body").val(),
            custom_include_headers: modalHtml.find("#st_api_form_include_headers").val(),
        };

        resultBox.removeClass("success error").addClass("loading").text("正在向模型发送推理请求，等待返回...").show();
        const res = await testApiConnection(tempProfile);
        resultBox.removeClass("loading");

        if (res.success) {
            resultBox.addClass("success").text(`✓ ${res.message}`);
        } else {
            resultBox.addClass("error").text(`✗ ${res.message}`);
        }
    });

    // Create modern SillyTavern popup instance
    const popup = new Popup(modalHtml, POPUP_TYPE.TEXT, '', {
        okButton: false,
        cancelButton: false,
        wide: true,
        large: true,
        allowVerticalScrolling: true
    });

    modalHtml.find("#st_api_btn_cancel_modal").on("click", () => {
        popup.complete(POPUP_RESULT.CANCELLED);
    });

    modalHtml.find("#st_api_btn_save_modal").on("click", () => {
        const name = modalHtml.find("#st_api_form_name").val().trim();
        const provider = modalHtml.find("#st_api_form_provider").val();
        const apiUrl = normalizeUrl(modalHtml.find("#st_api_form_url").val());
        const apiKey = modalHtml.find("#st_api_form_key").val().trim();
        const model = modalHtml.find("#st_api_form_model").val().trim();
        const stream = modalHtml.find("#st_api_form_stream").prop("checked") !== false;
        const custom_include_body = modalHtml.find("#st_api_form_include_body").val().trim();
        const custom_exclude_body = modalHtml.find("#st_api_form_exclude_body").val().trim();
        const custom_include_headers = modalHtml.find("#st_api_form_include_headers").val().trim();
        const notes = modalHtml.find("#st_api_form_notes").val().trim();

        if (!name) {
            toastr.error("请输入 API 别名 / 名称");
            return;
        }
        if (!apiUrl) {
            toastr.error("请输入 API 基础网址");
            return;
        }
        if (!model) {
            toastr.error("请填写或选择模型名称");
            return;
        }

        const settings = getSettings();
        const formId = modalHtml.find("#st_api_form_id").val();
        const profileId = formId || generateId();
        const setActive = modalHtml.find("#st_api_form_set_active").prop("checked");

        const profileData = {
            id: profileId,
            name,
            provider,
            apiUrl,
            apiKey,
            model,
            stream,
            custom_include_body,
            custom_exclude_body,
            custom_include_headers,
            notes,
            isActive: false,
            updatedAt: Date.now()
        };

        if (formId) {
            const idx = settings.profiles.findIndex(p => p.id === formId);
            if (idx >= 0) {
                profileData.createdAt = settings.profiles[idx].createdAt || Date.now();
                settings.profiles[idx] = profileData;
            } else {
                settings.profiles.push(profileData);
            }
        } else {
            profileData.createdAt = Date.now();
            settings.profiles.push(profileData);
        }

        if (setActive || settings.profiles.length === 1) {
            settings.activeProfileId = profileId;
            settings.profiles.forEach(p => p.isActive = (p.id === profileId));
        }

        persistSettings();
        toastr.success(`已保存 API 配置【${name}】`);

        popup.complete(POPUP_RESULT.AFFIRMATIVE);
        renderProfilesList();
        updateActiveBanner();

        if (setActive && settings.autoSyncToST !== false) {
            syncProfileToSillyTavern(profileData);
        }
    });

    popup.show();
}

/**
 * Export all profiles to JSON file
 */
function exportProfiles() {
    const settings = getSettings();
    const exportData = {
        version: "1.2.0",
        exportDate: new Date().toISOString(),
        profiles: settings.profiles || [],
        activeProfileId: settings.activeProfileId
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `st_api_profiles_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toastr.success("已导出 API 档案备份 JSON 文件！");
}

/**
 * Handle imported JSON file
 */
function handleImportFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            const list = Array.isArray(data) ? data : (data.profiles || []);
            if (list.length > 0) {
                const settings = getSettings();
                let addedCount = 0;
                list.forEach(item => {
                    if (item.name && item.apiUrl) {
                        const newProfile = {
                            id: item.id || generateId(),
                            name: item.name,
                            provider: item.provider || "custom",
                            apiUrl: normalizeUrl(item.apiUrl),
                            apiKey: item.apiKey || "",
                            model: item.model || "",
                            stream: item.stream !== false,
                            custom_include_body: item.custom_include_body || item.customBody || "",
                            custom_exclude_body: item.custom_exclude_body || "",
                            custom_include_headers: item.custom_include_headers || item.customHeaders || "",
                            notes: item.notes || "",
                            isActive: false,
                            createdAt: item.createdAt || Date.now(),
                            updatedAt: Date.now()
                        };
                        settings.profiles.push(newProfile);
                        addedCount++;
                    }
                });
                persistSettings();
                toastr.success(`成功导入 ${addedCount} 条 API 配置！`);
                renderProfilesList();
                updateActiveBanner();
            } else {
                toastr.warning("未解析到任何符合规范的 API 配置");
            }
        } catch (err) {
            toastr.error(`解析导入文件失败: ${err.message}`);
        }
    };
    reader.readAsText(file);
}

/**
 * Escape HTML
 */
function escapeHtml(text) {
    if (!text) return "";
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

/**
 * Register Slash Commands
 */
function registerSlashCommands() {
    try {
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'api-manager',
            callback: (args, value) => {
                const settings = getSettings();
                const subCommand = (value || '').trim();

                if (subCommand === 'list') {
                    const list = (settings.profiles || []).map(p => 
                        `${p.id === settings.activeProfileId ? '★ ' : '  '}[${p.provider}] ${p.name} -> ${p.model} (${p.apiUrl})`
                    ).join('\n');
                    return list || '暂无已保存的 API 配置';
                }

                if (subCommand.startsWith('set ')) {
                    const targetName = subCommand.replace(/^set\s+/, '').trim();
                    const target = (settings.profiles || []).find(p => p.name.toLowerCase() === targetName.toLowerCase());
                    if (target) {
                        setActiveProfile(target.id);
                        return `已激活 API 配置: ${target.name}`;
                    }
                    return `未找到名称为 "${targetName}" 的配置`;
                }

                const active = getActiveProfile();
                return active ? `当前有效 API: ${active.name} | 模型: ${active.model} | 网址: ${active.apiUrl} | 流式: ${active.stream !== false ? '开' : '关'}` : '当前未设置生效 API';
            },
            returns: 'API 管理器状态信息',
            unnamedArgumentList: [
                SlashCommandArgument.fromProps({
                    description: '子命令: list / set <name> / 留空查看当前生效',
                    typeList: [ARGUMENT_TYPE.STRING],
                    isRequired: false,
                }),
            ],
            helpString: '管理与查看本地保存的 API 配置。示例: /api-manager list 或 /api-manager set DeepSeek 官方',
        }));
    } catch (e) {
        console.warn(`[${MODULE_NAME}] Slash command registration skipped:`, e);
    }
}

/**
 * Main Extension Initialization Function
 */
export async function init() {
    if (isInitialized) return;
    isInitialized = true;

    try {
        const panelHtml = $(await renderExtensionTemplateAsync(TEMPLATE_PATH, "panel"));
        $("#extensions_settings").append(panelHtml);

        $("#st_api_btn_import_main").on("click", importCurrentMainApi);
        $("#st_api_btn_add").on("click", () => openEditModal());
        $("#st_api_btn_export").on("click", exportProfiles);
        $("#st_api_btn_import").on("click", () => $("#st_api_file_import").trigger("click"));
        $("#st_api_file_import").on("change", function() {
            if (this.files && this.files[0]) {
                handleImportFile(this.files[0]);
                $(this).val("");
            }
        });

        $("#st_api_search_input").on("input", function() {
            currentSearchQuery = $(this).val();
            renderProfilesList();
        });

        $(".st-api-nav-chip").on("click", function() {
            $(".st-api-nav-chip").removeClass("active");
            $(this).addClass("active");
            currentFilter = $(this).data("provider");
            renderProfilesList();
        });

        $("#st_api_btn_banner_test").on("click", async function() {
            const active = getActiveProfile();
            if (!active) return;
            const latencyIndicator = $("#st_api_banner_latency");
            latencyIndicator.removeClass("good warn bad").text("推理中...").show();
            const res = await testApiConnection(active);
            
            if (res.success) {
                const cls = res.latency < 800 ? "good" : (res.latency < 2500 ? "warn" : "bad");
                latencyIndicator.removeClass("good warn bad").addClass(cls).text(`${res.latency}ms (HTTP ${res.status || 200})`);
                toastr.success(`[${active.name}] ${res.message}`, "模型测试通过", { timeOut: 6000 });
            } else {
                latencyIndicator.removeClass("good warn bad").addClass("bad").text(`失败 (HTTP ${res.status || 'Err'})`);
                toastr.error(`[${active.name}] ${res.message}`, "模型测试失败", { timeOut: 8000 });
            }
        });

        $("#st_api_btn_banner_apply").on("click", function() {
            const active = getActiveProfile();
            if (active) {
                syncProfileToSillyTavern(active);
            } else {
                toastr.warning("当前暂无已激活生效的 API 档案");
            }
        });

        registerSlashCommands();
        renderProfilesList();
        updateActiveBanner();

        console.log(`[${MODULE_NAME}] Extension loaded successfully.`);
    } catch (err) {
        console.error(`[${MODULE_NAME}] Init error:`, err);
    }
}

// Auto-run on jQuery ready as well as export init
jQuery(async () => {
    await init();
});
