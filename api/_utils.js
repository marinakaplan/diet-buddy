// Blob read utility using direct fetch with aggressive cache bypass
// BLOB_READ_WRITE_TOKEN format: vercel_blob_rw_<storeId>_<random>

let _storeUrl = null;

export function getStoreUrl() {
    if (_storeUrl) return _storeUrl;
    const token = process.env.BLOB_READ_WRITE_TOKEN || '';
    const parts = token.split('_');
    // vercel_blob_rw_STOREID_random
    if (parts.length >= 5) {
        const storeId = parts[3];
        _storeUrl = `https://${storeId}.public.blob.vercel-storage.com`;
    }
    return _storeUrl;
}

export async function readBlob(pathname) {
    const storeUrl = getStoreUrl();
    if (!storeUrl) return null;
    try {
        // Use crypto-random nonce + pragma to bypass CDN caching entirely
        const nonce = Date.now() + '_' + Math.random().toString(36).slice(2);
        const resp = await fetch(`${storeUrl}/${pathname}.json?_=${nonce}`, {
            headers: {
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache'
            }
        });
        if (!resp.ok) return null;
        return resp.json();
    } catch (e) {
        return null;
    }
}
