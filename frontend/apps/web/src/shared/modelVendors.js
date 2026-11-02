export const MODEL_VENDORS = { mrtoken: 'mrtoken', custom: '自定义' };

export const modelVendorLabel = type => MODEL_VENDORS[type] || MODEL_VENDORS.custom;

// Existing OpenAI-compatible configurations remain usable after the vendor rename.
export const isExecutableModelProvider = provider => ['mrtoken', 'custom', 'openai'].includes(provider.type);
