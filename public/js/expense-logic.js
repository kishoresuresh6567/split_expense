(function(root){
  function shares(amount,ids){if(!Number.isSafeInteger(amount)||amount<=0||!ids.length||new Set(ids).size!==ids.length)throw Error('Invalid expense');return ids.map((id,i)=>({id,amount:Math.floor(amount/ids.length)+(i<amount%ids.length?1:0)}));}
  const splitMethods = {even:'Split evenly', amounts:'Split by amounts', shares:'Split by shares', percentage:'Split by percentage'};
  function decimalUnits(value){
    const text=String(value ?? '').trim();
    if(!/^\d+(\.\d{1,2})?$/.test(text))throw Error('Enter non-negative numbers with at most two decimal places.');
    const [whole,fraction='']=text.split('.');
    const result=Number(whole)*100+Number(fraction.padEnd(2,'0'));
    if(!Number.isSafeInteger(result)||result>10000000000)throw Error('The split value is too large.');
    return result;
  }
  function allocations(expense){
    const {amount,members}=expense;
    // This also validates the amount and participant list for every split method.
    const even=shares(amount,members);
    const {method='even',values={}}=expense.split || {};
    if(method==='even')return even;
    if(!Object.hasOwn(splitMethods,method))throw Error('Choose a valid split method.');
    const weights=members.map(id=>decimalUnits(values[id]));
    const total=weights.reduce((sum,value)=>sum+value,0);
    if(method==='amounts'){
      if(total!==amount)throw Error('Member amounts must add up to the expense total.');
      return members.map((id,index)=>({id,amount:weights[index]}));
    }
    if(method==='percentage'&&total!==10000)throw Error('Member percentages must add up to 100%.');
    if(method==='shares'&&weights.some(value=>value===0))throw Error('Each selected member needs more than zero shares.');
    if(!total)throw Error('Enter a positive split total.');
    // Integer arithmetic and largest remainders preserve every paisa, even for large values.
    const parts=weights.map((weight,index)=>{
      const numerator=BigInt(amount)*BigInt(weight),denominator=BigInt(total);
      return {id:members[index],amount:Number(numerator/denominator),remainder:numerator%denominator,index};
    });
    let remaining=amount-parts.reduce((sum,part)=>sum+part.amount,0);
    const order=[...parts].sort((a,b)=>a.remainder===b.remainder?a.index-b.index:a.remainder>b.remainder?-1:1);
    for(let i=0;i<remaining;i++)order[i].amount++;
    return parts.map(({id,amount})=>({id,amount}));
  }
  function balances(g){const b=Object.fromEntries(g.members.map(m=>[m.id,0]));for(const e of g.expenses){b[e.payer]+=e.amount;for(const s of allocations(e))b[s.id]-=s.amount;}for(const p of g.payments){b[p.from]+=p.amount;b[p.to]-=p.amount;}return b;}
  function settlements(g){const b=balances(g),owe=Object.entries(b).filter(x=>x[1]<0).map(([id,n])=>[id,-n]),owed=Object.entries(b).filter(x=>x[1]>0),out=[];let i=0,j=0;while(i<owe.length&&j<owed.length){const amount=Math.min(owe[i][1],owed[j][1]);out.push({from:owe[i][0],to:owed[j][0],amount});owe[i][1]-=amount;owed[j][1]-=amount;if(!owe[i][1])i++;if(!owed[j][1])j++;}return out;}
  function memberRemovalReason(g,id){
    if(!g.members.some(m=>m.id===id))return 'This member is no longer in the group.';
    if(g.expenses.some(e=>e.payer===id||e.members.includes(id))||g.payments.some(p=>p.from===id||p.to===id))return 'This member has recorded expenses or repayments. Remove those records first to keep balances accurate.';
    if(g.members.length<=1)return 'Keep at least one member in the group.';
    return '';
  }
  function removeMember(g,id){const reason=memberRemovalReason(g,id);if(reason)throw Error(reason);g.members=g.members.filter(m=>m.id!==id);}
  function updateExpenseSplit(g,id,members,payer,split,amount){
    const e=g.expenses.find(e=>e.id===id);
    if(!e)throw Error('This expense no longer exists.');
    if(!members.length)throw Error('Choose at least one member.');
    if(new Set(members).size!==members.length||members.some(id=>!g.members.some(m=>m.id===id))||!g.members.some(m=>m.id===payer))throw Error('Choose members and a payer from this group.');
    const next={...e,members:[...members],payer,split:split ?? e.split,amount:amount ?? e.amount};
    allocations(next);
    Object.assign(e,next);
  }
  const api={shares,allocations,decimalUnits,splitMethods,balances,settlements,memberRemovalReason,removeMember,updateExpenseSplit};if(typeof module!=='undefined')module.exports=api;else root.Split=api;
})(globalThis);
