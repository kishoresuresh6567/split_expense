const {test}=require('node:test');const assert=require('node:assert/strict');const {shares,balances,settlements}=require('../public/js/expense-logic');
const {removeMember}=require('../public/js/expense-logic');
const {updateExpenseSplit}=require('../public/js/expense-logic');
const {allocations}=require('../public/js/expense-logic');
test('A one-member group can record personal expenses without creating a debt',()=>{
 const g={members:[{id:'owner',email:'owner@example.com'}],expenses:[{id:'travel',amount:12345,payer:'owner',members:['owner']}],payments:[]};
 assert.deepEqual(allocations(g.expenses[0]),[{id:'owner',amount:12345}]);
 assert.deepEqual(balances(g),{owner:0});
 assert.deepEqual(settlements(g),[]);
 assert.throws(()=>removeMember(g,'owner'),/recorded|at least one/);
});
test('Exact amounts, weighted shares, and percentages use the chosen allocation',()=>{
 const base={amount:10000,members:['a','b','c']};
 assert.deepEqual(allocations({...base,split:{method:'amounts',values:{a:'10.25',b:'29.75',c:'60'}}}).map(p=>p.amount),[1025,2975,6000]);
 assert.deepEqual(allocations({...base,split:{method:'shares',values:{a:'1',b:'2',c:'1'}}}).map(p=>p.amount),[2500,5000,2500]);
 assert.deepEqual(allocations({...base,split:{method:'percentage',values:{a:'10',b:'30',c:'60'}}}).map(p=>p.amount),[1000,3000,6000]);
 assert.deepEqual(allocations(base),shares(base.amount,base.members));
});
test('Custom splits reject wrong totals, missing values, negative and zero shares',()=>{
 const base={amount:10000,members:['a','b']};
 for(const split of [
  {method:'amounts',values:{a:'40',b:'40'}},
  {method:'amounts',values:{a:'60',b:'60'}},
  {method:'percentage',values:{a:'40',b:'59.99'}},
  {method:'percentage',values:{a:'50',b:'50.01'}},
  {method:'shares',values:{a:'0',b:'2'}},
  {method:'shares',values:{a:'-1',b:'2'}},
  {method:'shares',values:{a:'1'}},
  {method:'shares',values:{a:'1.001',b:'2'}},
  {method:'unknown',values:{}}
 ])assert.throws(()=>allocations({...base,split}));
});
test('Uneven weighted splits preserve paise and zero percentages allocate nothing',()=>{
 assert.deepEqual(allocations({amount:101,members:['a','b','c'],split:{method:'percentage',values:{a:'0',b:'33.33',c:'66.67'}}}).map(p=>p.amount),[0,34,67]);
 for(const amount of [1,2,101,10000000000]){
  const parts=allocations({amount,members:['a','b','c'],split:{method:'shares',values:{a:'99999999.99',b:'0.01',c:'42.25'}}});
  assert.equal(parts.reduce((sum,p)=>sum+p.amount,0),amount);
  assert.ok(parts.every(p=>Number.isSafeInteger(p.amount)&&p.amount>=0));
 }
});
test('Changing split methods recalculates balances without changing repayments or other expenses',()=>{
 const g={members:[{id:'a'},{id:'b'}],expenses:[{id:'x',amount:10000,members:['a','b'],payer:'a'}],payments:[{from:'b',to:'a',amount:1000}]};
 const payments=structuredClone(g.payments);
 for(const split of [
  {method:'amounts',values:{a:'20',b:'80'}},
  {method:'shares',values:{a:'1',b:'4'}},
  {method:'percentage',values:{a:'20',b:'80'}}
 ]){
  updateExpenseSplit(g,'x',['a','b'],'a',split);
  assert.deepEqual(balances(g),{a:7000,b:-7000});
 }
 const before=structuredClone(g);
 assert.throws(()=>updateExpenseSplit(g,'x',['a','b'],'a',{method:'percentage',values:{a:'20',b:'20'}}));
 assert.deepEqual(g,before);
 updateExpenseSplit(g,'x',['a','b'],'a',{method:'even',values:{}});
 assert.deepEqual(balances(g),{a:4000,b:-4000});
 assert.deepEqual(g.payments,payments);
});
test('An existing five-person expense can include new members and exclude old ones without changing repayments',()=>{
 const g={members:['a','b','c','d','e','f'].map(id=>({id})),expenses:[{id:'lunch',amount:10001,payer:'a',members:['a','b','c','d','e']}],payments:[{from:'b',to:'a',amount:500}]};
 const payments=structuredClone(g.payments);
 updateExpenseSplit(g,'lunch',['a','b','c','d','e','f'],'a');
 assert.deepEqual(shares(g.expenses[0].amount,g.expenses[0].members).map(s=>s.amount),[1667,1667,1667,1667,1667,1666]);
 updateExpenseSplit(g,'lunch',['a','b','d','e','f'],'a');
 assert.equal(balances(g).c,0);removeMember(g,'c');
 assert.deepEqual(g.payments,payments);assert.equal(Object.values(balances(g)).reduce((a,b)=>a+b,0),0);
 const before=structuredClone(g);
 assert.throws(()=>updateExpenseSplit(g,'lunch',[],'a'),/at least one/);
 assert.throws(()=>updateExpenseSplit(g,'lunch',['missing'],'a'),/from this group/);
 assert.deepEqual(g,before);
});
test('Removing unused members preserves existing balances and prevents deleting recorded participants',()=>{
 const g={members:[{id:'a'},{id:'b'},{id:'c'}],expenses:[{amount:100,payer:'a',members:['b']}],payments:[]};
 removeMember(g,'c');assert.deepEqual(balances(g),{a:100,b:-100});
 assert.throws(()=>removeMember(g,'a'),/recorded/);assert.throws(()=>removeMember(g,'b'),/recorded/);
 g.payments=settlements(g);assert.throws(()=>removeMember(g,'a'),/recorded/);
 g.expenses=[];assert.throws(()=>removeMember(g,'a'),/recorded/);
 g.payments=[];removeMember(g,'a');assert.throws(()=>removeMember(g,'b'),/at least one/);
});
test('Equal split allocates all paise exactly',()=>{assert.deepEqual(shares(100,['a','b','c']),[{id:'a',amount:34},{id:'b',amount:33},{id:'c',amount:33}]);assert.equal(shares(1,['a','b','c']).reduce((n,s)=>n+s.amount,0),1);});
test('Only selected members owe, even if payer is excluded',()=>{const g={members:[{id:'a'},{id:'b'},{id:'c'}],expenses:[{amount:101,payer:'a',members:['b','c']}],payments:[]};assert.deepEqual(balances(g),{a:101,b:-51,c:-50});});
test('Suggested transfers clear balances and repayments prevent double counting',()=>{const g={members:[{id:'a'},{id:'b'},{id:'c'}],expenses:[{amount:100,payer:'a',members:['b','c']},{amount:25,payer:'c',members:['a','c']}],payments:[]};assert.deepEqual(balances(g),{a:87,b:-50,c:-37});g.payments=settlements(g);assert.deepEqual(balances(g),{a:0,b:0,c:0});assert.deepEqual(settlements(g),[]);g.payments.pop();assert.ok(settlements(g).length);});
test('Invalid amounts and repeated members cannot produce a split',()=>{for(const amount of [0,-1,1.5,NaN])assert.throws(()=>shares(amount,['a']));assert.throws(()=>shares(10,[]));assert.throws(()=>shares(10,['a','a']));});
