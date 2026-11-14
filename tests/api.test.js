import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createDatabase } from '../server/db.js';
import { createApp } from '../server/app.js';
import { createLlmAdapter, readLlmConfig } from '../server/llm.js';

function setup(t, options={}) {
  const db=createDatabase(':memory:',{seedDemo:options.seedDemo!==false});
  const llm=options.llm||createLlmAdapter(readLlmConfig({LLM_ENABLED:'false'}));
  const app=createApp({db,llm,demoMode:options.demoMode!==false,organizerPassword:'test-password-123',inviteCode:'TEST-CODE',...options});
  t.after(()=>db.close()); return {db,app};
}
const cookie=res=>res.headers['set-cookie'][0].split(';')[0];
async function team(app,role='team',teamId){const r=await request(app).post('/api/demo/login').send({role,teamId}).expect(200);return cookie(r);}
const notes='Мы проверяем проблему потерянных вещей в школе. Пользователь — ученик, который ищет свою куртку после урока. Записываем наблюдения и гипотезы отдельно.';
async function completeSteps(agent){for(let i=1;i<=4;i++)await agent.patch('/api/team/steps').send({stepIndex:i,completed:true,content:notes}).expect(200);}

test('bootstrap never leaks invite code, sessions or recovery hashes',async(t)=>{
 const {app,db}=setup(t); const r=await request(app).get('/api/bootstrap').expect(200); assert.equal(r.body.challenge.access_code,undefined);assert.equal(r.body.inviteHint,'TEST-CODE');assert.ok(r.body.demoTeams.length);assert.ok(!JSON.stringify(r.body).includes('access_hash'));
 assert.ok(db.prepare('SELECT COUNT(*) c FROM teams').get().c===6);
});
test('production disables public demo organizer and requires password',async(t)=>{
 const {app}=setup(t,{demoMode:false});await request(app).post('/api/demo/login').send({role:'organizer'}).expect(404);
 await request(app).post('/api/auth/organizer').send({password:'wrong'}).expect(401);
 const r=await request(app).post('/api/auth/organizer').send({password:'test-password-123'}).expect(200);assert.match(r.headers['set-cookie'][0],/HttpOnly/);
 await request(app).get('/api/organizer').set('Cookie',cookie(r)).expect(200);
 const boot=await request(app).get('/api/bootstrap');assert.equal(boot.body.inviteHint,null);assert.deepEqual(boot.body.demoTeams,[]);
});
test('team notes are private; other team and guest cannot read',async(t)=>{
 const {app}=setup(t);const a=await team(app,'team','team-eduquest'),b=await team(app,'team','team-studylab');
 await request(app).patch('/api/team/workbook').set('Cookie',a).send({stepIndex:1,content:'Секретный учебный черновик'}).expect(200);
 const rb=await request(app).get('/api/team').set('Cookie',b);assert.ok(!JSON.stringify(rb.body).includes('Секретный'));
 await request(app).get('/api/team').expect(401);await request(app).get('/api/organizer').set('Cookie',a).expect(401);
});
test('checkpoint requires real text and sequential completion; fifth is human-only',async(t)=>{
 const {app}=setup(t);const agent=request.agent(app);await agent.post('/api/demo/login').send({role:'team',teamId:'team-studylab'});
 await agent.patch('/api/team/steps').send({stepIndex:1,completed:true,content:'short'}).expect(400);
 await agent.patch('/api/team/steps').send({stepIndex:2,completed:true,content:notes}).expect(409);
 await agent.patch('/api/team/steps').send({stepIndex:5,completed:true,content:notes}).expect(400);
 await completeSteps(agent);const r=await agent.get('/api/team');assert.equal(r.body.team.steps.filter(s=>s.completed).length,4);assert.equal(r.body.team.xp,400);
 await agent.patch('/api/team/steps').send({stepIndex:1,completed:false}).expect(409);
});
test('submission → manual checklist → approved → unique showcase and score',async(t)=>{
 const {app,db}=setup(t);const agent=request.agent(app);await agent.post('/api/demo/login').send({role:'team'});
 const sub={title:'LostFound',url:'https://aistartify.com/startup/test-lostfound',description:'Помогаем школьникам находить потерянные вещи без публикации личных данных.',category:'EdTech'};
 await agent.post('/api/team/submission').send(sub).expect(409);await completeSteps(agent);await agent.post('/api/team/submission').send(sub).expect(201);
 await agent.post('/api/team/submission').send(sub).expect(409);await agent.patch('/api/team/workbook').send({stepIndex:1,content:notes}).expect(409); // evidence is frozen during review
 await agent.patch('/api/team/steps').send({stepIndex:1,completed:false}).expect(409);
 const org=await team(app,'organizer');const pending=await request(app).get('/api/organizer').set('Cookie',org);const item=pending.body.pending.find(p=>p.title==='LostFound');assert.ok(item.workbook.length===4);
 await request(app).post(`/api/organizer/submissions/${item.id}/review`).set('Cookie',org).send({decision:'approve'}).expect(400);
 const checklist={accessible:true,original:true,safe:true,complete:true};
 await request(app).post(`/api/organizer/submissions/${item.id}/review`).set('Cookie',org).send({decision:'approve',checklist}).expect(200);
 await request(app).post(`/api/organizer/submissions/${item.id}/review`).set('Cookie',org).send({decision:'approve',checklist}).expect(409);
 const r=await agent.get('/api/team');assert.equal(r.body.team.steps.filter(s=>s.completed).length,5);assert.equal(r.body.team.submission.status,'approved');
 const board=await request(app).get('/api/bootstrap');assert.equal(board.body.projects.filter(p=>p.title==='LostFound').length,1);
 assert.equal(db.prepare("SELECT COUNT(*) c FROM submissions WHERE status='approved'").get().c,3);
 const other=request.agent(app);await other.post('/api/demo/login').send({role:'team',teamId:'team-studylab'});await completeSteps(other);
 await other.post('/api/team/submission').send({...sub,url:sub.url+'?utm=copy#top'}).expect(409);
});
test('returned submission keeps identity and can be corrected',async(t)=>{
 const {app}=setup(t);const agent=request.agent(app);await agent.post('/api/demo/login').send({role:'team'});await completeSteps(agent);
 await agent.post('/api/team/submission').send({title:'SchoolLoop',url:'https://aistartify.com/startup/return-test',description:'Учебный проект для проверки процесса возврата и повторной отправки материалов.',category:'EdTech'}).expect(201);
 const orgAgent=request.agent(app);await orgAgent.post('/api/demo/login').send({role:'organizer'});
 let orgData=await orgAgent.get('/api/organizer');let item=orgData.body.pending.find(p=>p.title==='SchoolLoop');
 await orgAgent.post(`/api/organizer/submissions/${item.id}/review`).send({decision:'return',comment:''}).expect(400);
 await orgAgent.post(`/api/organizer/submissions/${item.id}/review`).send({decision:'return',comment:'Добавьте результаты интервью и проверьте описание.'}).expect(200);
 let r=await agent.get('/api/team');assert.equal(r.body.team.submission.status,'returned');assert.equal(r.body.team.steps.filter(s=>s.completed).length,4);
 await agent.patch('/api/team/steps').send({stepIndex:4,completed:false}).expect(200);
 await agent.patch('/api/team/steps').send({stepIndex:3,completed:false}).expect(200);
 await agent.patch('/api/team/steps').send({stepIndex:2,completed:false}).expect(200);
 await agent.patch('/api/team/steps').send({stepIndex:2,completed:true,content:notes+' Интервью проведены, выводы записаны.'}).expect(200);
 await agent.patch('/api/team/steps').send({stepIndex:3,completed:true,content:notes}).expect(200);
 await agent.patch('/api/team/steps').send({stepIndex:4,completed:true,content:notes}).expect(200);
 await agent.post('/api/team/submission').send({title:'SchoolLoop v2',url:'https://aistartify.com/startup/return-test',description:'Обновлённое описание проекта с результатами проверки проблемы и следующим шагом.',category:'EdTech'}).expect(201);
 r=await agent.get('/api/team');assert.equal(r.body.team.submission.id,item.id);assert.equal(r.body.team.submission.status,'pending');
});
test('new team gets one-time recovery key and can sign in on another client',async(t)=>{
 const {app,db}=setup(t,{demoMode:false});
 const fields={accessCode:'TEST-CODE',countryCode:'KZ',schoolName:'Pilot School',city:'Almaty',teamName:'Orbit Lab',nickname:'Captain',consent:true,ageConfirmed:true};
 await request(app).post('/api/teams').send({...fields,consent:false}).expect(400);
 await request(app).post('/api/teams').send({...fields,accessCode:'wrong'}).expect(400);
 const r=await request(app).post('/api/teams').send(fields).expect(201);assert.ok(r.body.recoveryKey.length>=20);assert.ok(db.prepare('SELECT access_hash FROM teams WHERE id=?').get(r.body.teamId).access_hash!==r.body.recoveryKey);
 await request(app).post('/api/teams').send(fields).expect(409);
 const login=await request(app).post('/api/auth/team').send({teamId:r.body.teamId,recoveryKey:r.body.recoveryKey}).expect(200);
 const me=await request(app).get('/api/me').set('Cookie',cookie(login));assert.equal(me.body.team.name,'Orbit Lab');assert.ok(!JSON.stringify(me.body).includes('recoveryKey'));
 await request(app).post('/api/auth/team').send({teamId:r.body.teamId,recoveryKey:'wrong'}).expect(401);
});
test('CSRF origin rejected, sessions hashed and logout invalidates token',async(t)=>{
 const {app,db}=setup(t);const r=await request(app).post('/api/demo/login').send({role:'team'}).expect(200);const c=cookie(r);const raw=c.split('=')[1];
 assert.ok(!db.prepare('SELECT token FROM sessions WHERE token=?').get(raw));
 await request(app).post('/api/logout').set('Origin','https://evil.example').set('Cookie',c).send({}).expect(403);
 await request(app).post('/api/logout').set('Cookie',c).send({}).expect(200);await request(app).get('/api/team').set('Cookie',c).expect(401);
});
test('organizer can exclude demo, export safe CSV; AI never approves',async(t)=>{
 const {app}=setup(t);const org=await team(app,'organizer');
 const live=await request(app).get('/api/organizer?includeDemo=false').set('Cookie',org).expect(200);assert.equal(live.body.funnel.total,0);
 const csv=await request(app).get('/api/organizer/export.csv').set('Cookie',org).expect(200);assert.match(csv.headers['content-type'],/text\/csv/);assert.match(csv.text,/EcoSchool/);
 await request(app).post('/api/organizer/llm/test').set('Cookie',org).send({}).expect(409);
});
test('mentor response persists, invalid request rejected, history can be deleted',async(t)=>{
 const {app}=setup(t);const agent=request.agent(app);await agent.post('/api/demo/login').send({role:'team'});
 await agent.post('/api/team/mentor').send({stepIndex:1,mode:'guide',message:'Что дальше?'}).expect(200);
 await agent.post('/api/team/mentor').send({stepIndex:5,mode:'guide'}).expect(400);
 let r=await agent.get('/api/team/mentor');assert.equal(r.body.messages.length,1);assert.equal(r.body.messages[0].source,'template');
 await agent.delete('/api/team/mentor').expect(200);r=await agent.get('/api/team/mentor');assert.equal(r.body.messages.length,0);
});
test('LLM errors are honest and counted, quota enforced',async(t)=>{
 const llm={publicStatus:()=>({enabled:true,model:'smallthinker'}),generate:async(t)=>{throw Object.assign(new Error('Offline'),{code:'llm_unavailable',status:503});}};
 const {app,db}=setup(t,{llm});const agent=request.agent(app);await agent.post('/api/demo/login').send({role:'team'});
 const r=await agent.post('/api/team/mentor').send({stepIndex:1,mode:'guide'}).expect(503);assert.equal(r.body.code,'llm_unavailable');assert.equal(db.prepare("SELECT COUNT(*) c FROM llm_calls WHERE status='error'").get().c,1);
 db.prepare('INSERT INTO llm_calls VALUES (?, ?, ?, ?, ?, 1, 0, 0, ?)').run('quota-test','team-eduquest','llm','smallthinker','ok',new Date().toISOString());
 // Forty requests in the last day including this one is still below the cap.
 for(let i=0;i<39;i++)db.prepare('INSERT INTO llm_calls VALUES (?, ?, ?, ?, ?, 1, 0, 0, ?)').run(`quota-${i}`,'team-eduquest','llm','smallthinker','ok',new Date().toISOString());
 await agent.post('/api/team/mentor').send({stepIndex:1,mode:'guide'}).expect(429);
});
test('non-demo seed creates no fictional schools or projects',async(t)=>{
 const {app}=setup(t,{seedDemo:false,demoMode:false});const r=await request(app).get('/api/bootstrap');assert.equal(r.body.stats.teams,0);assert.equal(r.body.projects.length,0);assert.ok(r.body.challenge.id);
});
test('expired sessions are rejected',async(t)=>{
 const {app,db}=setup(t);const c=await team(app);db.prepare('UPDATE sessions SET expires_at=?').run('2020-01-01T00:00:00.000Z');await request(app).get('/api/team').set('Cookie',c).expect(401);
});
test('real activation events, no invented historical telemetry, data deletion',async(t)=>{
 const {app,db}=setup(t,{seedDemo:false,demoMode:false,organizerPassword:'organizer-secret',inviteCode:'SPRINT-2026'});
 const agent=request.agent(app);
 await agent.post('/api/teams').send({teamName:'Measured Team',schoolName:'Measured School',countryCode:'KZ',nickname:'Student',accessCode:'SPRINT-2026',consent:true,ageConfirmed:true}).expect(201);
 await agent.patch('/api/team/workbook').send({stepIndex:1,content:'Первая заметка команды о проблеме в школе.'}).expect(200);
 await agent.patch('/api/team/workbook').send({stepIndex:1,content:'Вторая версия заметки команды о проблеме в школе.'}).expect(200);
 const orgAgent=request.agent(app); await orgAgent.post('/api/auth/organizer').send({password:'organizer-secret'}).expect(200);
 const metrics=await orgAgent.get('/api/organizer').expect(200);
 assert.equal(metrics.body.activation.measuredTeams,1);assert.ok(metrics.body.activation.medianFirstValueMinutes >= 0 && metrics.body.activation.medianFirstValueMinutes < 0.1);assert.equal(metrics.body.activation.d7Eligible,0);assert.equal(metrics.body.activation.d7Percent,null);
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM events WHERE type='first_note'").get().n,1);
 await agent.delete('/api/team/data').expect(200); await agent.get('/api/team').expect(401);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM teams').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM events').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM workbook').get().n,0);
});
test('non-demo public views hide seeded demo rows; referral approvals are counted',async(t)=>{
 const {app}=setup(t,{demoMode:false});
 const r=await request(app).get('/api/bootstrap').expect(200);
 assert.equal(r.body.projects.length,0);assert.equal(r.body.leaderboard.schools.length,0);assert.equal(r.body.stats.teams,0);assert.equal(r.body.schools.length,0);
 const {app:demoApp}=setup(t);
 const org=request.agent(demoApp);await org.post('/api/demo/login').send({role:'organizer'}).expect(200);
 const data=await org.get('/api/organizer').expect(200);
 assert.equal(data.body.referrals,2);assert.equal(data.body.referralsApproved,0);
});

test('bootstrap ships English content and the mentor replies in English on request',async(t)=>{
 const {app}=setup(t);
 const boot=await request(app).get('/api/bootstrap').expect(200);
 assert.equal(boot.body.steps.length,5);
 for(const step of boot.body.steps) assert.ok(step.en?.title && step.en?.prompt,`step ${step.index} has no English content`);
 assert.ok(boot.body.countries.every(c=>c.en?.name),'a pilot country has no English name');
 const agent=request.agent(app);await agent.post('/api/demo/login').send({role:'team'}).expect(200);
 const en=await agent.post('/api/team/mentor').send({stepIndex:2,mode:'guide',message:'What should we ask?',language:'en'}).expect(200);
 assert.equal(en.body.result.source,'template','the demo must stay honestly labelled as a template');
 assert.equal(en.body.result.model,null);
 assert.ok(!/[А-Яа-яЁё]/.test(en.body.result.reply),'English request returned a Russian reply');
 assert.match(en.body.result.reply,/Validate the problem/);
 const ru=await agent.post('/api/team/mentor').send({stepIndex:2,mode:'guide'}).expect(200);
 assert.ok(/[А-Яа-яЁё]/.test(ru.body.result.reply),'Russian must remain the default');
 await agent.post('/api/team/mentor').send({stepIndex:2,mode:'guide',language:'de'}).expect(400);
});
