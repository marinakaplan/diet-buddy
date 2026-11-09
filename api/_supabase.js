import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

let _client = null;

export function getSupabase() {
    if (!_client) {
        _client = createClient(supabaseUrl, supabaseKey);
    }
    return _client;
}
