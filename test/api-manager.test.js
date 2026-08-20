/**
 * ST-API-Manager Comprehensive Test Suite
 */

const assert = require('assert');

// Logic functions ported for standalone testing
function generateId() {
    return "api_" + Date.now().toString(36) + "_" + Math.random().toString(36).substring(2, 8);
}

function normalizeUrl(url) {
    if (!url) return "";
    let trimmed = url.trim();
    if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
        trimmed = "https://" + trimmed;
    }
    return trimmed.replace(/\/+$/, "");
}

function maskApiKey(key) {
    if (!key) return "<未设置密钥>";
    if (key.length <= 8) return "••••••••";
    return key.substring(0, 4) + "••••••••" + key.substring(key.length - 4);
}

function validateProfile(data) {
    if (!data.name || !data.name.trim()) return { valid: false, error: "API 名称不能为空" };
    if (!data.apiUrl || !data.apiUrl.trim()) return { valid: false, error: "API 网址不能为空" };
    if (!data.model || !data.model.trim()) return { valid: false, error: "模型名称不能为空" };
    return { valid: true };
}

function sanitizeForExport(profiles, includeKey = false) {
    return profiles.map(p => {
        const copy = JSON.parse(JSON.stringify(p));
        if (!includeKey) {
            copy.apiKey = "";
        }
        return copy;
    });
}

function parseModelList(data) {
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

function filterProfiles(profiles, provider = "all", searchQuery = "") {
    let list = [...profiles];
    if (provider !== "all") {
        list = list.filter(p => p.provider === provider);
    }
    if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        list = list.filter(p =>
            (p.name && p.name.toLowerCase().includes(q)) ||
            (p.apiUrl && p.apiUrl.toLowerCase().includes(q)) ||
            (p.model && p.model.toLowerCase().includes(q)) ||
            (p.notes && p.notes.toLowerCase().includes(q))
        );
    }
    return list;
}

// ==================== TEST RUNNER ====================
let passed = 0;
let failed = 0;

function it(desc, fn) {
    try {
        fn();
        console.log(`  ✓ ${desc}`);
        passed++;
    } catch (e) {
        console.error(`  ✗ ${desc}`);
        console.error(`    Error: ${e.message}`);
        failed++;
    }
}

console.log("\n=========================================");
console.log(" Running ST-API-Manager Unit Tests");
console.log("=========================================\n");

console.log("[1. URL Normalization & Validation]");
it("should auto-prefix https:// if scheme is omitted", () => {
    assert.strictEqual(normalizeUrl("api.deepseek.com/v1"), "https://api.deepseek.com/v1");
});

it("should strip trailing slashes", () => {
    assert.strictEqual(normalizeUrl("https://api.openai.com/v1///"), "https://api.openai.com/v1");
});

it("should preserve http for local endpoints like Ollama", () => {
    assert.strictEqual(normalizeUrl("http://127.0.0.1:11434/v1/"), "http://127.0.0.1:11434/v1");
});

it("should validate required profile fields (name, url, model)", () => {
    assert.strictEqual(validateProfile({ name: "", apiUrl: "https://api.com", model: "m" }).valid, false);
    assert.strictEqual(validateProfile({ name: "test", apiUrl: "", model: "m" }).valid, false);
    assert.strictEqual(validateProfile({ name: "test", apiUrl: "https://api.com", model: "" }).valid, false);
    assert.strictEqual(validateProfile({ name: "test", apiUrl: "https://api.com", model: "gpt-4o" }).valid, true);
});

console.log("\n[2. API Key Security & Masking]");
it("should mask long API keys in UI display", () => {
    const masked = maskApiKey("sk-proj-1234567890abcdef123456");
    assert.ok(masked.startsWith("sk-p"));
    assert.ok(masked.endsWith("3456"));
    assert.ok(masked.includes("••••••••"));
});

it("should return placeholder for empty keys", () => {
    assert.strictEqual(maskApiKey(""), "<未设置密钥>");
    assert.strictEqual(maskApiKey(null), "<未设置密钥>");
});

it("should strictly sanitize API keys when exported without key permission", () => {
    const sampleProfiles = [
        { id: "1", name: "DeepSeek", apiUrl: "https://api.deepseek.com/v1", apiKey: "sk-secret-key-1", model: "deepseek-chat" },
        { id: "2", name: "Claude", apiUrl: "https://api.anthropic.com/v1", apiKey: "sk-ant-secret-2", model: "claude-3-5-sonnet" }
    ];

    // Sanitized export
    const sanitized = sanitizeForExport(sampleProfiles, false);
    assert.strictEqual(sanitized[0].apiKey, "");
    assert.strictEqual(sanitized[1].apiKey, "");
    assert.strictEqual(sanitized[0].name, "DeepSeek");

    // Full backup export
    const backup = sanitizeForExport(sampleProfiles, true);
    assert.strictEqual(backup[0].apiKey, "sk-secret-key-1");
    assert.strictEqual(backup[1].apiKey, "sk-ant-secret-2");
});

console.log("\n[3. Profile CRUD & Activation Logic]");
const store = {
    profiles: [],
    activeProfileId: null
};

it("should add a new profile and set as active if first profile", () => {
    const newProfile = {
        id: generateId(),
        name: "主力 DeepSeek",
        provider: "deepseek",
        apiUrl: normalizeUrl("https://api.deepseek.com/v1"),
        apiKey: "sk-test123",
        model: "deepseek-chat",
        temperature: 1.0,
        maxTokens: 4096,
        isActive: true,
        notes: "测试主力"
    };
    store.profiles.push(newProfile);
    store.activeProfileId = newProfile.id;

    assert.strictEqual(store.profiles.length, 1);
    assert.strictEqual(store.activeProfileId, newProfile.id);
});

it("should add a second profile and switch active properly", () => {
    const secondProfile = {
        id: generateId(),
        name: "备用 Claude",
        provider: "claude",
        apiUrl: normalizeUrl("https://api.anthropic.com/v1"),
        apiKey: "sk-test456",
        model: "claude-3-5-sonnet-20241022",
        isActive: false
    };
    store.profiles.push(secondProfile);

    // Switch active to second
    store.activeProfileId = secondProfile.id;
    store.profiles.forEach(p => p.isActive = (p.id === secondProfile.id));

    assert.strictEqual(store.profiles.length, 2);
    assert.strictEqual(store.activeProfileId, secondProfile.id);
    assert.strictEqual(store.profiles[0].isActive, false);
    assert.strictEqual(store.profiles[1].isActive, true);
});

it("should clone an existing profile", () => {
    const original = store.profiles[0];
    const clone = {
        ...JSON.parse(JSON.stringify(original)),
        id: generateId(),
        name: `${original.name} (副本)`,
        isActive: false
    };
    store.profiles.push(clone);

    assert.strictEqual(store.profiles.length, 3);
    assert.strictEqual(clone.name, "主力 DeepSeek (副本)");
    assert.strictEqual(clone.isActive, false);
});

it("should delete a profile and fallback active if active was deleted", () => {
    // Delete active profile (secondProfile)
    const activeId = store.activeProfileId;
    store.profiles = store.profiles.filter(p => p.id !== activeId);
    if (store.activeProfileId === activeId) {
        store.activeProfileId = store.profiles.length > 0 ? store.profiles[0].id : null;
        if (store.activeProfileId) {
            store.profiles[0].isActive = true;
        }
    }

    assert.strictEqual(store.profiles.length, 2);
    assert.strictEqual(store.activeProfileId, store.profiles[0].id);
    assert.strictEqual(store.profiles[0].isActive, true);
});

console.log("\n[4. Search and Filter Engine]");
it("should filter by provider", () => {
    const list = [
        { name: "A", provider: "openai", model: "gpt-4o" },
        { name: "B", provider: "deepseek", model: "deepseek-chat" },
        { name: "C", provider: "claude", model: "claude-3-5" }
    ];

    const deepseekOnly = filterProfiles(list, "deepseek", "");
    assert.strictEqual(deepseekOnly.length, 1);
    assert.strictEqual(deepseekOnly[0].name, "B");
});

it("should search across name, model, notes, and endpoint", () => {
    const list = [
        { name: "生产环境", provider: "custom", model: "qwen-max", apiUrl: "https://my-proxy.com", notes: "VIP 专用通道" },
        { name: "测试环境", provider: "openai", model: "gpt-4o", apiUrl: "https://api.openai.com/v1", notes: "日常闲聊" }
    ];

    assert.strictEqual(filterProfiles(list, "all", "VIP").length, 1);
    assert.strictEqual(filterProfiles(list, "all", "gpt-4o").length, 1);
    assert.strictEqual(filterProfiles(list, "all", "proxy").length, 1);
    assert.strictEqual(filterProfiles(list, "all", "none-existent").length, 0);
});

console.log("\n[5. Remote Model List Parsing]");
it("should parse OpenAI data[] model array", () => {
    const response = {
        data: [
            { id: "gpt-4o", object: "model" },
            { id: "gpt-4o-mini", object: "model" }
        ]
    };
    const models = parseModelList(response);
    assert.deepStrictEqual(models, ["gpt-4o", "gpt-4o-mini"]);
});

it("should parse Ollama models[] array", () => {
    const response = {
        models: [
            { name: "llama3:8b", size: 4000000 },
            { name: "qwen2.5:7b", size: 4500000 }
        ]
    };
    const models = parseModelList(response);
    assert.deepStrictEqual(models, ["llama3:8b", "qwen2.5:7b"]);
});

console.log("\n=========================================");
console.log(` Test Results: ${passed} Passed, ${failed} Failed`);
console.log("=========================================\n");

if (failed > 0) {
    process.exit(1);
}
