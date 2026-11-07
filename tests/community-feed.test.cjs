const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('a reset discards older feed requests and overlapping pagination cannot duplicate posts', async () => {
  const source = fs.readFileSync('assets/community.js', 'utf8');
  const pending = [];
  const visible = [];
  const controls = {
    feed: {replaceChildren(){visible.length = 0;}, append(...cards){visible.push(...cards);}},
    more: {hidden: false}
  };
  const context = vm.createContext({
    $: id => controls[id], location: {search: ''}, URLSearchParams,
    api: path => new Promise(resolve => pending.push({path, resolve})),
    card: async post => post.id, el: () => 'empty'
  });
  vm.runInContext('let offset=0,feedVersion=0;\n' +
    source.slice(source.indexOf('async function feed('), source.indexOf("$('more').onclick")), context);
  const old = context.feed(true);
  const fresh = context.feed(true);
  pending[1].resolve({posts: Array.from({length:20}, (_, i) => ({id:'new-'+i}))});
  await fresh;
  pending[0].resolve({posts:[{id:'old'}]});
  await old;
  assert.equal(visible.length,20);
  assert.ok(!visible.includes('old'));
  assert.equal(controls.more.hidden,false);
  const first = context.feed();
  const second = context.feed();
  assert.equal(pending[2].path,'posts?offset=20');
  assert.equal(pending[3].path,'posts?offset=20');
  pending[3].resolve({posts:[{id:'next'}]});
  await second;
  pending[2].resolve({posts:[{id:'next'}]});
  await first;
  assert.equal(visible.filter(id => id === 'next').length,1);
  assert.equal(vm.runInContext('offset',context),21);
});
