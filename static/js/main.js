(() => {
  const KEYS = { users:'sai_users', me:'sai_current_user', preds:'sai_predictions' };

  // LS helpers
  const lsGet = (k,f)=>{ try{return JSON.parse(localStorage.getItem(k))??f;}catch{return f;} };
  const lsSet = (k,v)=> localStorage.setItem(k, JSON.stringify(v));

  // Backup helper (sendBeacon on redirect, else fetch)
  async function backupToServer({sync=false} = {}) {
    const payload = {
      users: lsGet(KEYS.users, []),
      predictions: lsGet(KEYS.preds, [])
    };
    try {
      if (sync && navigator.sendBeacon) {
        const blob = new Blob([JSON.stringify(payload)], {type:'application/json'});
        navigator.sendBeacon('/api/save_snapshot', blob);
        return;
      }
      await fetch('/api/save_snapshot', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify(payload)
      });
    } catch (e) {
      console.warn('Backup failed', e);
    }
  }

  function seedIfNeeded() {
    const users = lsGet(KEYS.users, []);
    if (!users.length || !users.some(u => u.is_admin)) {
      const admin = {
        id:'admin-'+Date.now(),
        name:'Admin',
        email:'admin@suraksha.com',
        password:'admin123',
        is_admin:true,
        created_on:new Date().toISOString()
      };
      users.push(admin);
      lsSet(KEYS.users, users);
      console.log('Admin seeded');
    }
    if (!lsGet(KEYS.preds, null)) lsSet(KEYS.preds, []);
    // first load snapshot
    backupToServer();
  }

  function currentUser(){ return lsGet(KEYS.me, null); }

  function updateNav(){
    const me = currentUser();
    const $ = id => document.getElementById(id);
    const show = (id, flag)=>{ const el=$(id); if (el) el.classList.toggle('d-none', !flag); };
    show('navLogin', !me); show('navRegister', !me);
    show('navLogout', !!me); show('navDashboard', !!me && !me.is_admin);
    show('navAdmin', !!me && me.is_admin);
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) logoutBtn.onclick = async () => {
      localStorage.removeItem(KEYS.me);
      await backupToServer({sync:true});
      updateNav(); window.location.href='/';
    };
  }

  function initLogin(){
    const form = document.getElementById('loginForm'); if (!form) return;
    form.addEventListener('submit', async (e)=>{
      e.preventDefault();
      const email = document.getElementById('loginEmail').value.trim().toLowerCase();
      const pass  = document.getElementById('loginPassword').value;
      const users = lsGet(KEYS.users, []);
      const user = users.find(u => u.email.toLowerCase() === email);
      if (!user || user.password !== pass) { alert('Invalid email or password'); return; }
      lsSet(KEYS.me, user);
      await backupToServer();
      updateNav();
      window.location.href = user.is_admin ? '/admin' : '/dashboard';
    });
  }

  function initRegister(){
    const form = document.getElementById('registerForm'); if (!form) return;
    form.addEventListener('submit', async (e)=>{
      e.preventDefault();
      const name = document.getElementById('regName').value.trim();
      const email = document.getElementById('regEmail').value.trim().toLowerCase();
      const pass  = document.getElementById('regPassword').value;
      const users = lsGet(KEYS.users, []);
      if (users.some(u => u.email.toLowerCase() === email)) {
        alert('Email already registered. Please login.'); window.location.href='/login'; return;
      }
      users.push({ id:'u-'+Date.now(), name, email, password:pass, is_admin:false, created_on:new Date().toISOString() });
      lsSet(KEYS.users, users);
      // IMPORTANT: backup BEFORE redirect (sync=true uses sendBeacon)
      await backupToServer({sync:true});
      alert('Registration successful! Please login.');
      window.location.href='/login';
    });
  }

  // Dashboard
  let probChart=null, trendChart=null;
  function initUserDashboard(){
    const form = document.getElementById('predictionForm'); if (!form) return;
    const me = currentUser(); if (!me){ window.location.href='/login'; return; }

    const resultCard = document.getElementById('resultCard');
    const resultContent = document.getElementById('resultContent');
    const statsSection = document.getElementById('statsSection');
    const trendSection = document.getElementById('trendSection');

    form.addEventListener('submit', async (e)=>{
      e.preventDefault();
      const btn = document.getElementById('submitBtn'); btn.disabled=true; btn.textContent='Analyzing...';

      const inputs = form.querySelectorAll('input');
      const payload = {};
      inputs.forEach(inp => {
        const k = inp.id; let v = parseFloat(inp.value);
        if (Number.isNaN(v)) v = (k==='Amount'||k==='transaction_time') ? 0 : 0.5;
        payload[k] = v;
      });

      try{
        const res = await fetch('/api/predict', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
        const data = await res.json();

        const isFraud = data.prediction === 'Fraud';
        resultContent.innerHTML = `
          <h4 class="${isFraud?'text-danger':'text-success'} mb-1">Prediction: ${data.prediction}</h4>
          <p class="mb-0">Fraud Probability: <strong>${(data.probability*100).toFixed(2)}%</strong></p>
        `;
        resultCard.style.display='block';
        drawProb(data.probability);

        // save to local
        const preds = lsGet(KEYS.preds, []);
        preds.push({ id:'p-'+Date.now(), user_id:me.id, result:data, input:payload, timestamp:new Date().toISOString() });
        lsSet(KEYS.preds, preds);

        // backup to server (async ok)
        await backupToServer();

        updateStats(); drawTrend();
        statsSection.style.display='block'; trendSection.style.display='block';
      }catch(err){
        console.error(err); alert('Prediction error');
      }finally{
        btn.disabled=false; btn.textContent='🔍 Analyze Transaction Risk';
      }
    });

    function drawProb(prob){
      const ctx = document.getElementById('probabilityChart').getContext('2d');
      if (probChart) probChart.destroy();
      probChart = new Chart(ctx, {
        type:'bar',
        data:{ labels:['Legitimate','Fraud'], datasets:[{ data:[1-prob, prob], backgroundColor:['#27ae60','#e74c3c'] }] },
        options:{ responsive:true, maintainAspectRatio:false, scales:{ y:{beginAtZero:true,max:1} }, plugins:{legend:{display:false}} }
      });
    }

    function updateStats(){
      const preds = lsGet(KEYS.preds, []).filter(p=>p.user_id===me.id);
      const total = preds.length;
      const fraud = preds.filter(p=>p.result.prediction==='Fraud').length;
      const rate = total ? ((fraud/total)*100).toFixed(1) : 0;
      document.getElementById('totalCount').textContent = total;
      document.getElementById('fraudCount').textContent = fraud;
      document.getElementById('fraudRate').textContent = `${rate}%`;
    }

    function drawTrend(){
      const preds = lsGet(KEYS.preds, []).filter(p=>p.user_id===me.id);
      const labels = preds.map((_,i)=>`Tx ${i+1}`);
      const vals = preds.map(p=>p.result.probability*100);
      const ctx = document.getElementById('trendChart').getContext('2d');
      if (trendChart) trendChart.destroy();
      trendChart = new Chart(ctx, {
        type:'line',
        data:{ labels, datasets:[{ label:'Fraud Probability (%)', data:vals, borderColor:'#4A00E0', backgroundColor:'rgba(142,45,226,0.15)', fill:true, tension:0.15 }] },
        options:{ responsive:true, maintainAspectRatio:false, scales:{ y:{beginAtZero:true,max:100} } }
      });
    }

    // if already present
    if (lsGet(KEYS.preds, []).length){ statsSection.style.display='block'; trendSection.style.display='block'; updateStats(); drawTrend(); }
  }

  function initAdmin(){
    const table = document.getElementById('admRecentPreds'); if (!table) return;
    const me = currentUser(); if (!me || !me.is_admin){ window.location.href='/login'; return; }

    const users = lsGet(KEYS.users, []), preds = lsGet(KEYS.preds, []);
    document.getElementById('admTotalUsers').textContent = users.length;
    document.getElementById('admTotalPreds').textContent = preds.length;
    document.getElementById('admFraudPreds').textContent = preds.filter(p=>p.result.prediction==='Fraud').length;

    const recent = preds.slice(-10).reverse();
    table.innerHTML = recent.map((p, idx) => {
      const u = users.find(x=>x.id===p.user_id);
      const name = u ? `${u.name} (${u.email})` : 'Unknown';
      return `<tr><td>${idx+1}</td><td>${name}</td><td>${p.result.prediction}</td><td>${(p.result.probability*100).toFixed(1)}</td><td>${new Date(p.timestamp).toLocaleString()}</td></tr>`;
    }).join('');
  }

  document.addEventListener('DOMContentLoaded', () => {
    seedIfNeeded();
    updateNav();
    initLogin();
    initRegister();
    initUserDashboard();
    initAdmin();
  });

  // optional helper for console testing
  window.DEBUG_BACKUP = backupToServer;
})();