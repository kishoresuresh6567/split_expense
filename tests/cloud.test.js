const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadCloud(client) {
  const context = {window:{}, SUPABASE_URL:'https://example.supabase.co', SUPABASE_KEY:'test-publishable-key',
    location:{origin:'https://gather.example',pathname:'/',hash:'#edit=secret'}, createClient:() => client};
  const source = fs.readFileSync(path.join(__dirname,'../src/cloud.js'),'utf8').replace("import {createClient} from '@supabase/supabase-js';",'');
  vm.runInNewContext(source,context);
  return context.window.Cloud;
}

test('creator login redirects through Google without forwarding group link secrets', async () => {
  let request;
  const cloud = loadCloud({auth:{signInWithOAuth:async args => { request = args; return {data:{provider:'google'},error:null}; }}});
  await cloud.signIn();
  assert.equal(request.provider,'google');
  assert.equal(request.options.redirectTo,'https://gather.example/');
  assert.equal(request.options.queryParams.prompt,'select_account');
  for (const removed of ['signUp','resetPassword','setPassword','signInWithPassword','invite','accept','revoke','invitations','access']) {
    assert.equal(cloud[removed],undefined,`${removed} is no longer exposed`);
  }
});

test('Google sign-in errors are passed back for display and retry', async () => {
  const error = Error('Google provider is not enabled');
  const cloud = loadCloud({auth:{signInWithOAuth:async () => ({data:null,error})}});
  await assert.rejects(cloud.signIn(),error);
});

test('link visitors use only link RPCs, without member lookup', async () => {
  const calls = [];
  const cloud = loadCloud({rpc:(name,args) => {
    calls.push({name,args});
    return {single:async () => ({data:{id:'group',version:2},error:null})};
  }});
  assert.equal((await cloud.readLink('secret')).id,'group');
  assert.equal((await cloud.saveLink('secret',{id:'group'},1)).version,2);
  assert.equal(calls[0].name,'gather_read_link');
  assert.equal(calls[1].name,'gather_save_link');
  assert.equal(calls[1].args.link_token,'secret');
  assert.equal(calls[1].args.expected_version,1);
});

test('profile names use the signed-in user RPCs', async () => {
  const calls = [];
  const cloud = loadCloud({rpc:(name,args) => {
    calls.push({name,args});
    return Promise.resolve({data:name === 'gather_member_names' ? [{email:'member@example.com',display_name:'Member'}] : 'Member',error:null});
  }});
  assert.equal(await cloud.myName(),'Member');
  assert.equal(await cloud.setMyName('Member'),'Member');
  assert.deepEqual(await cloud.memberNames('group'),[{email:'member@example.com',display_name:'Member'}]);
  assert.deepEqual(calls.map(call => call.name),['gather_my_name','gather_set_my_name','gather_member_names']);
  assert.equal(calls[1].args.new_name,'Member');
  assert.equal(calls[2].args.gid,'group');
});
