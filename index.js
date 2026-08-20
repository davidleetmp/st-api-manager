import { extension_settings, renderExtensionTemplateAsync } from "../../extensions.js";
import { saveSettingsDebounced } from "../../../script.js";
import { callPopup } from "../../popup.js";
import { SlashCommandParser } from "../../slash-commands/SlashCommandParser.js";
import { SlashCommand } from "../../slash-commands/SlashCommand.js";
import { SlashCommandArgument, SlashCommandNamedArgument, ARGUMENT_TYPE } from "../../slash-commands/SlashCommandArgument.js";

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
        maxTokens: 4096,
        temperature: 1.0,
        stream: true,
        notes: "DeepSeek 官方 API 接口 (兼容 OpenAI 规范)"
    },
    openai: {
        name: "OpenAI 官方",
        provider: "openai",
        apiUrl: "https://api.openai.com/v1",
        model: "gpt-4o",
        maxTokens: 4096,
        temperature: 1.0,
        stream: true,
        notes: "OpenAI 官方标准接口"
    },
    claude: {
        name: "Anthropic Claude",
        provider: "claude",
        apiUrl: "https://api.anthropic.com/v1",
        model: "claude-3-5-sonnet-20241022",
        maxTokens: 8192,
        temperature: 1.0,
        stream: true,
        notes: "Anthropic Claude 官方接口"
    },
    gemini: {
        name: "Google Gemini",
        provider: "gemini",
        apiUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
        model: "gemini-2.5-flash",
        maxTokens: 8192,
        temperature: 1.0,
        stream: true,
        notes: "Google Gemini OpenAI 兼容端点"
    },
    siliconflow: {
        name: "硅基流动 (SiliconFlow)",
        provider: "siliconflow",
        apiUrl: "https://api.siliconflow.cn/v1",
        model: "deepseek-ai/DeepSeek-V3",
        maxTokens: 4096,
        temperature: 1.0,
        stream: true,
        notes: "硅基流动国内高并发托管平台"
    },
    openrouter: {
        name: "OpenRouter",
        provider: "openrouter",
        apiUrl: "https://openrouter.ai/api/v1",
        model: "deepseek/deepseek-r1",
        maxTokens: 4096,
        temperature: 1.0,
        stream: true,
        notes: "OpenRouter 聚合路由器"
    },
    ollama: {
        name: "Ollama (本地)",
        provider: "ollama",
        apiUrl: "http://127.0.0.1:11434/v1",
        model: "llama3:8b",
        maxTokens: 4096,
        temperature: 0.8,
        stream: true,
        notes: "本地运行的 Ollama 服务"
    },
    custom: {
        name: "",
        provider: "custom",
        apiUrl: "",
        model: "",
        maxTokens: 4096,
        temperature: 1.0,
        stream: true,
        notes: ""
    }
};

let currentFilter = "all";
let currentSearchQuery = "";

/**
 * Generate unique profile ID
 */
function generateId() {
    return "api_" + Date.now().toString(36) + "_" + Math.random().toString(36).substring(2, 8);
}

/**
 * Normalizes URL string
 */
function normalizeUrl(url) {
    if (!url) return "";
    let trimmed = url.trim();
    if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
        trimmed = "https://" + trimmed;
    }
    return trimmed.replace(/\/+$/, "");
}

/**
 * Mask API Key for safe UI display
 */
function maskApiKey(key) {
    if (!key) return "<未设置密钥>";
    if (key.length <= 8) return "••••••••";
    return key.substring(0, 4) + "••••••••" + key.substring(key.length - 4);
}

/**
 * Load settings or initialize defaults
 */
function getSettings() {
    if (!extension_settings[MODULE_NAME]) {
        extension_settings[MODULE_NAME] = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    }
    return extension_settings[MODULE_NAME];
}

/**
 * Save settings to SillyTavern storage
 */
function persistSettings() {
    saveSettingsDebounced();
}

/**
 * Get active profile
 */
function getActiveProfile() {
    const settings = getSettings();
    if (!settings.profiles || settings.profiles.length === 0) return null;
    return settings.profiles.find(p => p.id === settings.activeProfileId) || null;
}

/**
 * Set active profile by ID
 */
function setActiveProfile(profileId, syncToUI = true) {
    const settings = getSettings();
    settings.activeProfileId = profileId;
    settings.profiles.forEach(p => {
        p.isActive = (p.id === profileId);
    });
    persistSettings();

    const active = getActiveProfile();
    if (active) {
        toastr.success(`已切换生效 API: ${active.name} (${active.model})`);
        if (settings.autoSyncToST) {
            syncProfileToSillyTavern(active);
        }
    }

    if (syncToUI) {
        renderProfilesList();
        updateActiveBanner();
    }
}

/**
 * Synchronize profile configuration with SillyTavern's active settings if possible
 */
function syncProfileToSillyTavern(profile) {
    if (!profile) return;
    try {
        // Try filling SillyTavern OpenAI-compatible API input fields if present
        const urlInput = $('#api_url_text');
        if (urlInput.length && profile.apiUrl) {
            urlInput.val(profile.apiUrl).trigger('input').trigger('change');
        }
        const keyInput = $('#api_key_openai');
        if (keyInput.length && profile.apiKey) {
            keyInput.val(profile.apiKey).trigger('input').trigger('change');
        }
        const modelInput = $('#model_openai_select');
        if (modelInput.length && profile.model) {
            modelInput.val(profile.model).trigger('input').trigger('change');
        }
    } catch (err) {
        console.warn(`[${MODULE_NAME}] sync to ST main fields skipped:`, err);
    }
}

/**
 * Test connectivity for an API profile
 */
async function testApiConnection(profile) {
    if (!profile || !profile.apiUrl) {
        return { success: false, message: "API 基础网址不能为空" };
    }

    const startTime = Date.now();
    const cleanUrl = normalizeUrl(profile.apiUrl);
    
    // Construct headers
    const headers = {
        "Content-Type": "application/json",
    };
    if (profile.apiKey) {
        headers["Authorization"] = `Bearer ${profile.apiKey}`;
        if (profile.provider === "claude") {
            headers["x-api-key"] = profile.apiKey;
            headers["anthropic-version"] = "2023-06-01";
        }
    }

    // Merge custom headers if defined
    if (profile.customHeaders) {
        try {
            const custom = typeof profile.customHeaders === "string" ? JSON.parse(profile.customHeaders) : profile.customHeaders;
            Object.assign(headers, custom);
        } catch (e) {
            console.warn(`[${MODULE_NAME}] Custom headers JSON parse error:`, e);
        }
    }

    try {
        // Try testing with /models endpoint first, then /chat/completions fallback
        let targetUrl = `${cleanUrl}/models`;
        let response = null;
        let latency = 0;

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);
            
            response = await fetch(targetUrl, {
                method: "GET",
                headers,
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            latency = Date.now() - startTime;
        } catch (getErr) {
            // If GET /models failed or CORS blocked, try POST /chat/completions with minimal payload
            const testPayload = {
                model: profile.model || "gpt-3.5-turbo",
                messages: [{ role: "user", content: "Hi" }],
                max_tokens: 1
            };
            
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 12000);
            
            response = await fetch(`${cleanUrl}/chat/completions`, {
                method: "POST",
                headers,
                body: JSON.stringify(testPayload),
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            latency = Date.now() - startTime;
        }

        if (response && (response.ok || response.status === 200 || response.status === 400 || response.status === 404)) {
            // If status is 200 or reachable
            if (response.ok) {
                return {
                    success: true,
                    latency,
                    status: response.status,
                    message: `连接成功！响应延迟: ${latency}ms (HTTP ${response.status})`
                };
            } else {
                return {
                    success: true,
                    latency,
                    status: response.status,
                    message: `端点可达 (HTTP ${response.status})，延迟: ${latency}ms`
                };
            }
        } else {
            return {
                success: false,
                latency: Date.now() - startTime,
                status: response ? response.status : 0,
                message: `请求失败: HTTP ${response ? response.status : "无响应"} (${response ? response.statusText : "Network Error"})`
            };
        }
    } catch (err) {
        return {
            success: false,
            latency: Date.now() - startTime,
            message: `连接出错: ${err.message || err}`
        };
    }
}

/**
 * Fetch remote model list from API
 */
async function fetchRemoteModels(apiUrl, apiKey, customHeaders) {
    if (!apiUrl) throw new Error("请先填写 API 网址");
    const cleanUrl = normalizeUrl(apiUrl);
    const headers = { "Content-Type": "application/json" };
    if (apiKey) {
        headers["Authorization"] = `Bearer ${apiKey}`;
    }
    if (customHeaders) {
        try {
            const custom = typeof customHeaders === "string" ? JSON.parse(customHeaders) : customHeaders;
            Object.assign(headers, custom);
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
    countAll.text(profiles.length);

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
            <div class="st-api-card ${isActive ? 'is-active-card' : ''}" data-id="${profile.id}">
                <div class="st-api-card-header">
                    <div class="st-api-card-title-group">
                        <span class="st-api-card-name">${escapeHtml(profile.name || '未命名 API')}</span>
                        <span class="st-api-tag ${providerClass}">${providerLabel}</span>
                        ${isActive ? '<span class="st-api-badge st-api-badge-active"><i class="fa-solid fa-bolt"></i> 当前生效</span>' : ''}
                    </div>
                </div>

                <div class="st-api-card-body">
                    <div class="st-api-card-row">
                        <i class="fa-solid fa-link" title="Endpoint URL"></i>
                        <span class="st-api-code-text">${escapeHtml(profile.apiUrl || '-')}</span>
                    </div>
                    <div class="st-api-card-row">
                        <i class="fa-solid fa-microchip" title="Model"></i>
                        <strong style="color:#60a5fa;">${escapeHtml(profile.model || '-')}</strong>
                    </div>
                    <div class="st-api-card-row">
                        <i class="fa-solid fa-key" title="API Key"></i>
                        <div class="st-api-key-wrapper">
                            <span class="st-api-code-text st-api-key-display">${maskApiKey(profile.apiKey)}</span>
                            <button type="button" class="st-api-mini-btn st-api-btn-copy-key" title="复制密钥">
                                <i class="fa-regular fa-copy"></i>
                            </button>
                        </div>
                    </div>
                    
                    <div class="st-api-card-badges">
                        ${profile.temperature !== undefined ? `<span class="st-api-param-pill">Temp: ${profile.temperature}</span>` : ''}
                        ${profile.maxTokens ? `<span class="st-api-param-pill">MaxTokens: ${profile.maxTokens}</span>` : ''}
                        ${profile.contextLength ? `<span class="st-api-param-pill">Ctx: ${profile.contextLength}</span>` : ''}
                        ${profile.stream ? `<span class="st-api-param-pill">Stream</span>` : ''}
                        ${profile.customHeaders ? `<span class="st-api-param-pill" title="${escapeHtml(profile.customHeaders)}">Headers</span>` : ''}
                    </div>

                    ${profile.notes ? `<div class="st-api-card-notes">${escapeHtml(profile.notes)}</div>` : ''}
                </div>

                <div class="st-api-card-footer">
                    <div class="st-api-card-actions-left">
                        ${isActive ? `
                            <button type="button" class="menu_button st-api-btn-is-active" disabled>
                                <i class="fa-solid fa-circle-check"></i> 生效中
                            </button>
                        ` : `
                            <button type="button" class="menu_button st-api-btn-set-active" title="设为当前生效 API">
                                <i class="fa-solid fa-bolt"></i> 设为有效
                            </button>
                        `}
                        <button type="button" class="menu_button st-api-btn-test-card" title="测试该配置连通性">
                            <i class="fa-solid fa-network-wired"></i> 测试
                        </button>
                    </div>

                    <div class="st-api-card-actions-right">
                        <button type="button" class="menu_button st-api-btn-clone-card" title="克隆复制此配置">
                            <i class="fa-solid fa-clone"></i>
                        </button>
                        <button type="button" class="menu_button st-api-btn-edit-card" title="修改编辑">
                            <i class="fa-solid fa-pen-to-square"></i>
                        </button>
                        <button type="button" class="menu_button st-api-btn-delete-card" title="删除">
                            <i class="fa-solid fa-trash" style="color:#f87171;"></i>
                        </button>
                    </div>
                </div>
            </div>
        `);

        // Event bindings for card buttons
        card.find(".st-api-btn-set-active").on("click", () => {
            setActiveProfile(profile.id);
        });

        card.find(".st-api-btn-test-card").on("click", async function() {
            const btn = $(this);
            btn.prop("disabled", true).html('<i class="fa-solid fa-spinner fa-spin"></i> 测试中...');
            const result = await testApiConnection(profile);
            btn.prop("disabled", false).html('<i class="fa-solid fa-network-wired"></i> 测试');
            
            if (result.success) {
                toastr.success(`[${profile.name}] ${result.message}`);
            } else {
                toastr.error(`[${profile.name}] ${result.message}`);
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
        banner.hide();
        topBadge.hide();
        return;
    }

    topBadgeName.text(active.name);
    topBadge.show();

    $("#st_api_banner_name").text(active.name);
    $("#st_api_banner_provider").text((active.provider || 'custom').toUpperCase());
    $("#st_api_banner_url").text(active.apiUrl || '-');
    $("#st_api_banner_model").text(active.model || '-');
    banner.show();
}

/**
 * Open Modal to Add or Edit Profile
 */
async function openEditModal(existingProfile = null) {
    const modalHtml = $(await renderExtensionTemplateAsync(TEMPLATE_PATH, "modal"));
    
    // Set Header
    modalHtml.find("#st_api_modal_heading").text(existingProfile ? "编辑 API 配置" : "新增 API 配置");

    // Prepopulate fields if editing
    if (existingProfile) {
        modalHtml.find("#st_api_form_id").val(existingProfile.id);
        modalHtml.find("#st_api_form_name").val(existingProfile.name || "");
        modalHtml.find("#st_api_form_provider").val(existingProfile.provider || "custom");
        modalHtml.find("#st_api_form_url").val(existingProfile.apiUrl || "");
        modalHtml.find("#st_api_form_key").val(existingProfile.apiKey || "");
        modalHtml.find("#st_api_form_model").val(existingProfile.model || "");
        modalHtml.find("#st_api_form_temperature").val(existingProfile.temperature ?? "");
        modalHtml.find("#st_api_form_top_p").val(existingProfile.topP ?? "");
        modalHtml.find("#st_api_form_max_tokens").val(existingProfile.maxTokens ?? "");
        modalHtml.find("#st_api_form_context_len").val(existingProfile.contextLength ?? "");
        modalHtml.find("#st_api_form_stream").prop("checked", existingProfile.stream !== false);
        modalHtml.find("#st_api_form_headers").val(existingProfile.customHeaders || "");
        modalHtml.find("#st_api_form_custom_body").val(existingProfile.customBody || "");
        modalHtml.find("#st_api_form_sysprompt").val(existingProfile.systemPrompt || "");
        modalHtml.find("#st_api_form_notes").val(existingProfile.notes || "");
        modalHtml.find("#st_api_form_set_active").prop("checked", !!existingProfile.isActive);
    } else {
        modalHtml.find("#st_api_form_set_active").prop("checked", true);
    }

    // Tab Switching
    modalHtml.find(".st-api-tab-btn").on("click", function() {
        const tab = $(this).data("tab");
        modalHtml.find(".st-api-tab-btn").removeClass("active");
        modalHtml.find(".st-api-tab-pane").removeClass("active");
        $(this).addClass("active");
        modalHtml.find(`#st_tab_${tab}`).addClass("active");
    });

    // Preset Chips
    modalHtml.find(".st-api-chip").on("click", function() {
        const presetKey = $(this).data("preset");
        const preset = PRESETS[presetKey];
        if (preset) {
            if (preset.name && !modalHtml.find("#st_api_form_name").val()) {
                modalHtml.find("#st_api_form_name").val(preset.name);
            }
            modalHtml.find("#st_api_form_provider").val(preset.provider);
            modalHtml.find("#st_api_form_url").val(preset.apiUrl);
            modalHtml.find("#st_api_form_model").val(preset.model);
            if (preset.maxTokens) modalHtml.find("#st_api_form_max_tokens").val(preset.maxTokens);
            if (preset.temperature) modalHtml.find("#st_api_form_temperature").val(preset.temperature);
            if (preset.notes && !modalHtml.find("#st_api_form_notes").val()) {
                modalHtml.find("#st_api_form_notes").val(preset.notes);
            }
            toastr.info(`已应用【${preset.name || presetKey}】预设模板`);
        }
    });

    // Toggle Key visibility
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

    // Paste Key
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

    // Normalize URL button
    modalHtml.find("#st_api_btn_normalize_url").on("click", () => {
        const urlInput = modalHtml.find("#st_api_form_url");
        urlInput.val(normalizeUrl(urlInput.val()));
        toastr.info("已规范化 API 网址格式");
    });

    // Fetch Models button
    modalHtml.find("#st_api_btn_fetch_models").on("click", async function() {
        const btn = $(this);
        const url = modalHtml.find("#st_api_form_url").val();
        const key = modalHtml.find("#st_api_form_key").val();
        const headersStr = modalHtml.find("#st_api_form_headers").val();

        if (!url) {
            toastr.warning("请先填写 API 网址");
            return;
        }

        btn.prop("disabled", true).find("#st_api_fetch_btn_text").text("拉取中...");
        try {
            const models = await fetchRemoteModels(url, key, headersStr);
            const datalist = modalHtml.find("#st_api_model_datalist");
            datalist.empty();
            models.forEach(m => {
                datalist.append(`<option value="${escapeHtml(m)}">`);
            });

            if (models.length > 0) {
                if (!modalHtml.find("#st_api_form_model").val()) {
                    modalHtml.find("#st_api_form_model").val(models[0]);
                }
                toastr.success(`成功拉取 ${models.length} 个模型！`);
            } else {
                toastr.info("端点响应成功，但未解析到可用模型列表");
            }
        } catch (err) {
            toastr.error(`拉取模型失败: ${err.message}`);
        } finally {
            btn.prop("disabled", false).find("#st_api_fetch_btn_text").text("拉取模型");
        }
    });

    // Test in Modal
    modalHtml.find("#st_api_btn_test_modal").on("click", async function() {
        const resultBox = modalHtml.find("#st_api_modal_test_result");
        const tempProfile = {
            apiUrl: modalHtml.find("#st_api_form_url").val(),
            apiKey: modalHtml.find("#st_api_form_key").val(),
            model: modalHtml.find("#st_api_form_model").val(),
            provider: modalHtml.find("#st_api_form_provider").val(),
            customHeaders: modalHtml.find("#st_api_form_headers").val(),
        };

        resultBox.removeClass("success error").addClass("loading").text("正在测试连接...").show();
        const res = await testApiConnection(tempProfile);
        resultBox.removeClass("loading");

        if (res.success) {
            resultBox.addClass("success").text(`✓ ${res.message}`);
        } else {
            resultBox.addClass("error").text(`✗ ${res.message}`);
        }
    });

    // Call ST Popup
    const popupPromise = callPopup(modalHtml, "text", "", { okButton: false, cancelButton: false, wide: true, large: true });

    modalHtml.find("#st_api_btn_cancel_modal").on("click", () => {
        $('.popup-button-cancel, dialog[class^=popup] .popup-button-close').trigger('click');
        $('dialog[class^=popup]').remove();
    });

    modalHtml.find("#st_api_btn_save_modal").on("click", () => {
        const name = modalHtml.find("#st_api_form_name").val().trim();
        const provider = modalHtml.find("#st_api_form_provider").val();
        const apiUrl = normalizeUrl(modalHtml.find("#st_api_form_url").val());
        const apiKey = modalHtml.find("#st_api_form_key").val().trim();
        const model = modalHtml.find("#st_api_form_model").val().trim();

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
            temperature: parseFloat(modalHtml.find("#st_api_form_temperature").val()) || undefined,
            topP: parseFloat(modalHtml.find("#st_api_form_top_p").val()) || undefined,
            maxTokens: parseInt(modalHtml.find("#st_api_form_max_tokens").val(), 10) || undefined,
            contextLength: parseInt(modalHtml.find("#st_api_form_context_len").val(), 10) || undefined,
            stream: modalHtml.find("#st_api_form_stream").prop("checked"),
            customHeaders: modalHtml.find("#st_api_form_headers").val().trim(),
            customBody: modalHtml.find("#st_api_form_custom_body").val().trim(),
            systemPrompt: modalHtml.find("#st_api_form_sysprompt").val().trim(),
            notes: modalHtml.find("#st_api_form_notes").val().trim(),
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

        // Close modal
        $('dialog[class^=popup]').remove();

        renderProfilesList();
        updateActiveBanner();
    });
}

/**
 * Export profiles as JSON file
 */
function exportProfiles() {
    const settings = getSettings();
    const profiles = settings.profiles || [];
    if (profiles.length === 0) {
        toastr.warning("暂无 API 配置可供导出");
        return;
    }

    const includeKey = confirm("是否在导出文件中包含 API 密钥 (Key)？\n\n【确定】包含密钥（完整备份，请妥善保管勿公开）\n【取消】脱敏导出（不含私密密钥，适合安全分享）");

    const exportData = {
        version: "1.0.0",
        exportDate: new Date().toISOString(),
        profiles: profiles.map(p => {
            const copy = JSON.parse(JSON.stringify(p));
            if (!includeKey) {
                copy.apiKey = "";
            }
            return copy;
        })
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `st-api-profiles-${includeKey ? 'backup' : 'share'}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toastr.success("API 配置导出成功！");
}

/**
 * Import profiles from JSON file
 */
function handleImportFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            const importedList = Array.isArray(data) ? data : (data.profiles || []);
            if (!Array.isArray(importedList) || importedList.length === 0) {
                toastr.error("导入失败：未在文件中找到有效的 profiles 列表");
                return;
            }

            const settings = getSettings();
            let addedCount = 0;

            importedList.forEach(item => {
                if (item && item.apiUrl && item.name) {
                    const newProfile = {
                        id: generateId(),
                        name: item.name,
                        provider: item.provider || "custom",
                        apiUrl: normalizeUrl(item.apiUrl),
                        apiKey: item.apiKey || "",
                        model: item.model || "",
                        temperature: item.temperature,
                        topP: item.topP,
                        maxTokens: item.maxTokens,
                        contextLength: item.contextLength,
                        stream: item.stream !== false,
                        customHeaders: typeof item.customHeaders === "object" ? JSON.stringify(item.customHeaders, null, 2) : (item.customHeaders || ""),
                        customBody: typeof item.customBody === "object" ? JSON.stringify(item.customBody, null, 2) : (item.customBody || ""),
                        systemPrompt: item.systemPrompt || "",
                        notes: item.notes || "",
                        isActive: false,
                        createdAt: Date.now(),
                        updatedAt: Date.now()
                    };
                    settings.profiles.push(newProfile);
                    addedCount++;
                }
            });

            if (addedCount > 0) {
                if (!settings.activeProfileId && settings.profiles.length > 0) {
                    setActiveProfile(settings.profiles[0].id, false);
                }
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
                return active ? `当前有效 API: ${active.name} | 模型: ${active.model} | 网址: ${active.apiUrl}` : '当前未设置生效 API';
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
 * Extension Startup / Initialization
 */
jQuery(async () => {
    try {
        // Load HTML template
        const panelHtml = $(await renderExtensionTemplateAsync(TEMPLATE_PATH, "panel"));

        // Append to SillyTavern extensions drawer
        $("#extensions_settings").append(panelHtml);

        // Toolbar Events
        $("#st_api_btn_add").on("click", () => openEditModal());
        $("#st_api_btn_export").on("click", exportProfiles);
        $("#st_api_btn_import").on("click", () => $("#st_api_file_import").trigger("click"));
        $("#st_api_file_import").on("change", function() {
            if (this.files && this.files[0]) {
                handleImportFile(this.files[0]);
                $(this).val("");
            }
        });

        // Search Input
        $("#st_api_search_input").on("input", function() {
            currentSearchQuery = $(this).val();
            renderProfilesList();
        });

        // Filter Tags
        $(".st-api-filter-tag").on("click", function() {
            $(".st-api-filter-tag").removeClass("active");
            $(this).addClass("active");
            currentFilter = $(this).data("provider");
            renderProfilesList();
        });

        // Banner actions
        $("#st_api_btn_banner_test").on("click", async function() {
            const active = getActiveProfile();
            if (!active) return;
            const latencyIndicator = $("#st_api_banner_latency");
            latencyIndicator.removeClass("good warn bad").text("测试中...").show();
            const res = await testApiConnection(active);
            
            if (res.success) {
                const cls = res.latency < 500 ? "good" : (res.latency < 1500 ? "warn" : "bad");
                latencyIndicator.removeClass("good warn bad").addClass(cls).text(`${res.latency}ms (HTTP ${res.status || 200})`);
                toastr.success(`[${active.name}] ${res.message}`);
            } else {
                latencyIndicator.removeClass("good warn bad").addClass("bad").text(`错误 (HTTP ${res.status || 'Err'})`);
                toastr.error(`[${active.name}] ${res.message}`);
            }
        });

        $("#st_api_btn_banner_apply").on("click", function() {
            const active = getActiveProfile();
            if (active) {
                syncProfileToSillyTavern(active);
                toastr.success(`已将【${active.name}】参数同步填入酒馆连接设置！`);
            }
        });

        // Register Slash Commands
        registerSlashCommands();

        // Initial Render
        renderProfilesList();
        updateActiveBanner();

        console.log(`[${MODULE_NAME}] Extension loaded successfully.`);
    } catch (err) {
        console.error(`[${MODULE_NAME}] Init error:`, err);
    }
});
