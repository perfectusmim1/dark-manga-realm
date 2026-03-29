
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://gmczrwjjlysiryvwxkgb.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdtY3pyd2pqbHlzaXJ5dnd4a2diIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY0ODE3NzIsImV4cCI6MjA4MjA1Nzc3Mn0.uZnPa6FM7DBXJ9ZclWpKGN4UaFJJtFsR7BifPBnEEnQ';

async function testFetch() {
  console.log('Testing Edge Function with INVALID JWT...');
  const response = await fetch(`${supabaseUrl}/functions/v1/admin-user-access`, {
    method: 'POST',
    headers: {
      'apikey': supabaseAnonKey,
      'Authorization': 'Bearer NOT_A_JWT',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ action: 'history', targetUserId: 'test' })
  });
  
  const status = response.status;
  const body = await response.text();
  console.log('Status:', status);
  console.log('Body:', body);
}

testFetch();
