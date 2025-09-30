import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '../.env' });

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://supabase.apertia.ai';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_SERVICE_KEY) {
    console.error('❌ SUPABASE_SERVICE_KEY not found in environment variables');
    console.error('   Please ensure .env file exists with SUPABASE_SERVICE_KEY');
    process.exit(1);
}

// Create Supabase client with service role key
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});

async function listExistingTables() {
    console.log('\n🔍 Exploring Existing Tables...');
    console.log('================================');

    // Tables we found from the API response
    const tables = [
        'users',
        'sessions',
        'messages',
        'user_usage',
        'daily_usage',
        'session_summary'
    ];

    for (const table of tables) {
        try {
            const { data, error } = await supabase
                .from(table)
                .select('*')
                .limit(1);

            if (error) {
                console.log(`❌ ${table}: ${error.message}`);
            } else {
                console.log(`✅ ${table}: Accessible (${data.length} records fetched)`);
                if (data.length > 0) {
                    console.log(`   Sample fields: ${Object.keys(data[0]).join(', ')}`);
                }
            }
        } catch (err) {
            console.log(`❌ ${table}: ${err.message}`);
        }
    }
}

async function testCRUDOperations() {
    console.log('\n📝 Testing CRUD Operations...');
    console.log('================================');

    // Test creating a new user
    console.log('\n1. CREATE - Adding a new user:');
    const newUser = {
        email: 'test@example.com',
        name: 'Test User',
        user_type: 'regular'
    };

    const { data: createdUser, error: createError } = await supabase
        .from('users')
        .insert(newUser)
        .select()
        .single();

    if (createError) {
        console.log(`   ❌ Create failed: ${createError.message}`);
    } else {
        console.log(`   ✅ Created user: ${createdUser.id}`);
        console.log(`      Email: ${createdUser.email}`);
        console.log(`      Name: ${createdUser.name}`);

        // Test reading
        console.log('\n2. READ - Fetching the user:');
        const { data: readUser, error: readError } = await supabase
            .from('users')
            .select('*')
            .eq('id', createdUser.id)
            .single();

        if (readError) {
            console.log(`   ❌ Read failed: ${readError.message}`);
        } else {
            console.log(`   ✅ Read user: ${readUser.email}`);
        }

        // Test updating
        console.log('\n3. UPDATE - Modifying the user:');
        const { error: updateError } = await supabase
            .from('users')
            .update({ name: 'Updated Test User' })
            .eq('id', createdUser.id);

        if (updateError) {
            console.log(`   ❌ Update failed: ${updateError.message}`);
        } else {
            console.log(`   ✅ Updated user name successfully`);
        }

        // Test deleting
        console.log('\n4. DELETE - Removing the user:');
        const { error: deleteError } = await supabase
            .from('users')
            .delete()
            .eq('id', createdUser.id);

        if (deleteError) {
            console.log(`   ❌ Delete failed: ${deleteError.message}`);
        } else {
            console.log(`   ✅ Deleted user successfully`);
        }
    }
}

async function testSessionTracking() {
    console.log('\n📊 Testing Session Tracking...');
    console.log('================================');

    // Create a test session
    const newSession = {
        session_id: `test-session-${Date.now()}`,
        user_email: 'test@example.com',
        project_path: '/test/project',
        git_branch: 'main',
        started_at: new Date().toISOString(),
        machine_id: 'test-machine',
        message_count: 0,
        total_tokens: 0,
        total_cost: 0
    };

    const { data: session, error: sessionError } = await supabase
        .from('sessions')
        .insert(newSession)
        .select()
        .single();

    if (sessionError) {
        console.log(`❌ Session creation failed: ${sessionError.message}`);
    } else {
        console.log(`✅ Created session: ${session.session_id}`);

        // Add a message to the session
        const newMessage = {
            session_id: session.id,
            message_uuid: `msg-${Date.now()}`,
            role: 'user',
            content: 'Test message',
            timestamp: new Date().toISOString(),
            model: 'claude-3',
            input_tokens: 10,
            output_tokens: 20
        };

        const { data: message, error: messageError } = await supabase
            .from('messages')
            .insert(newMessage)
            .select()
            .single();

        if (messageError) {
            console.log(`   ❌ Message creation failed: ${messageError.message}`);
        } else {
            console.log(`   ✅ Added message to session`);

            // Update session stats
            const { error: updateError } = await supabase
                .from('sessions')
                .update({
                    message_count: 1,
                    total_tokens: 30,
                    total_cost: 0.001
                })
                .eq('id', session.id);

            if (!updateError) {
                console.log(`   ✅ Updated session statistics`);
            }

            // Clean up
            await supabase.from('messages').delete().eq('id', message.id);
            await supabase.from('sessions').delete().eq('id', session.id);
            console.log(`   🧹 Cleaned up test data`);
        }
    }
}

async function testAdvancedQueries() {
    console.log('\n🔬 Testing Advanced Queries...');
    console.log('================================');

    // Test aggregations
    console.log('\n1. Aggregation - User usage statistics:');
    const { data: userUsage, error: usageError } = await supabase
        .from('user_usage')
        .select('*')
        .limit(5);

    if (usageError) {
        console.log(`   ❌ Failed: ${usageError.message}`);
    } else {
        console.log(`   ✅ Found ${userUsage.length} user usage records`);
        if (userUsage.length > 0) {
            console.log('   Sample user stats:');
            userUsage.forEach(u => {
                console.log(`   - ${u.user_email}: ${u.total_messages} messages, ${u.total_tokens} tokens`);
            });
        }
    }

    // Test daily usage
    console.log('\n2. Time-series data - Daily usage:');
    const { data: dailyUsage, error: dailyError } = await supabase
        .from('daily_usage')
        .select('*')
        .order('date', { ascending: false })
        .limit(5);

    if (dailyError) {
        console.log(`   ❌ Failed: ${dailyError.message}`);
    } else {
        console.log(`   ✅ Found ${dailyUsage.length} daily usage records`);
        if (dailyUsage.length > 0) {
            console.log('   Recent daily stats:');
            dailyUsage.forEach(d => {
                console.log(`   - ${d.date}: ${d.active_users} users, ${d.messages} messages`);
            });
        }
    }
}

async function testTableCreation() {
    console.log('\n🏗️ Testing Table Creation...');
    console.log('================================');

    // With service role key, we should be able to create tables using SQL
    let data, error;
    try {
        const result = await supabase.rpc('query', {
            query: `
                CREATE TABLE IF NOT EXISTS test_analytics (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    event_name TEXT NOT NULL,
                    event_data JSONB,
                    user_id UUID,
                    created_at TIMESTAMPTZ DEFAULT NOW()
                )
            `
        });
        data = result.data;
        error = result.error;
    } catch (err) {
        error = err;
    }

    if (error) {
        console.log(`❌ Cannot create tables directly: ${error.message || error}`);
        console.log('   Note: Table creation might require database admin access');
    } else {
        console.log(`✅ Table created successfully`);

        // Try to drop the test table
        try {
            await supabase.rpc('query', {
                query: 'DROP TABLE IF EXISTS test_analytics'
            });
        } catch (e) {
            // Ignore errors
        }
    }
}

// Run all tests
async function runAllTests() {
    console.log('🚀 SUPABASE CAPABILITY TESTING');
    console.log('================================');
    console.log(`URL: ${SUPABASE_URL}`);
    console.log(`Role: service_role (full access)`);
    console.log(`Valid until: ${new Date(1789725365 * 1000).toLocaleDateString()}`);

    await listExistingTables();
    await testCRUDOperations();
    await testSessionTracking();
    await testAdvancedQueries();
    await testTableCreation();

    console.log('\n✅ Testing Complete!');
}

runAllTests().catch(console.error);