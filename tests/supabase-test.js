// Load environment variables
import dotenv from 'dotenv';
dotenv.config({ path: '../.env' });

// Test Supabase connection
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://supabase.apertia.ai';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_SERVICE_KEY) {
    console.error('❌ SUPABASE_SERVICE_KEY not found in environment variables');
    console.error('   Please ensure .env file exists with SUPABASE_SERVICE_KEY');
    process.exit(1);
}

// Decode JWT payload (base64)
const payload = JSON.parse(Buffer.from(SUPABASE_SERVICE_KEY.split('.')[1], 'base64').toString());
console.log('JWT Payload:', JSON.stringify(payload, null, 2));

// Calculate expiration date
const expDate = new Date(payload.exp * 1000);
const iatDate = new Date(payload.iat * 1000);
console.log('Issued at:', iatDate.toISOString());
console.log('Expires at:', expDate.toISOString());
console.log('Valid for:', Math.floor((expDate - iatDate) / (1000 * 60 * 60 * 24)), 'days');

async function testSupabaseConnection() {
    console.log('\n--- Testing Supabase Connection ---');

    // Test basic connection with service role key
    try {
        const response = await fetch(`${SUPABASE_URL}/rest/v1/`, {
            headers: {
                'apikey': SUPABASE_SERVICE_KEY,
                'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
            }
        });

        console.log('Connection status:', response.status);
        const text = await response.text();
        console.log('Response:', text.substring(0, 200));
    } catch (error) {
        console.error('Connection error:', error.message);
    }
}

async function listTables() {
    console.log('\n--- Listing Database Tables ---');

    try {
        // Query information_schema to get all tables
        const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_tables`, {
            method: 'POST',
            headers: {
                'apikey': SUPABASE_SERVICE_KEY,
                'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({})
        });

        if (!response.ok) {
            // Try alternative method - query tables directly
            const tablesResponse = await fetch(`${SUPABASE_URL}/rest/v1/`, {
                headers: {
                    'apikey': SUPABASE_SERVICE_KEY,
                    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
                    'Accept': 'application/json'
                }
            });

            console.log('Tables endpoint status:', tablesResponse.status);
            const data = await tablesResponse.text();
            console.log('Available endpoints:', data);
        } else {
            const tables = await response.json();
            console.log('Tables:', tables);
        }
    } catch (error) {
        console.error('Error listing tables:', error.message);
    }
}

async function createTestTable() {
    console.log('\n--- Testing Table Creation ---');

    try {
        // Using Supabase Management API to create a table
        const sqlQuery = `
            CREATE TABLE IF NOT EXISTS test_table_${Date.now()} (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255),
                created_at TIMESTAMP DEFAULT NOW()
            );
        `;

        // Execute SQL via the SQL endpoint
        const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
            method: 'POST',
            headers: {
                'apikey': SUPABASE_SERVICE_KEY,
                'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ query: sqlQuery })
        });

        console.log('Create table response:', response.status);
        const result = await response.text();
        console.log('Result:', result);

    } catch (error) {
        console.error('Error creating table:', error.message);
    }
}

async function testDatabaseOperations() {
    console.log('\n--- Testing Database Operations ---');

    // Test creating a simple record in a test table
    try {
        const testData = {
            name: 'Test Record',
            description: 'Created via API',
            created_at: new Date().toISOString()
        };

        const response = await fetch(`${SUPABASE_URL}/rest/v1/test_records`, {
            method: 'POST',
            headers: {
                'apikey': SUPABASE_SERVICE_KEY,
                'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=representation'
            },
            body: JSON.stringify(testData)
        });

        console.log('Insert response:', response.status);
        if (response.ok) {
            const data = await response.json();
            console.log('Inserted data:', data);
        } else {
            const error = await response.text();
            console.log('Insert error:', error);
        }
    } catch (error) {
        console.error('Database operation error:', error.message);
    }
}

// Run all tests
async function runAllTests() {
    await testSupabaseConnection();
    await listTables();
    await createTestTable();
    await testDatabaseOperations();
}

runAllTests().catch(console.error);