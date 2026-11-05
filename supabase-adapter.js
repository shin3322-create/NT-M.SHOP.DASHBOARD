/*
 * supabase-adapter.js
 *
 * 기존 클로드 아티팩트 버전이 쓰던 db.doc()/db.collection() 형태의 API를
 * 그대로 흉내내는 얇은 어댑터입니다.
 *
 * [2026-11 전송량(egress) 절감 수정]
 * 이전 버전은 구독마다 30초마다 select * 전체 재조회 + 실시간 이벤트가 올 때마다
 * (다른 달/다른 지점 행이 바뀌어도) 전체 재조회를 했기 때문에, 화면을 켜 둔
 * 대수만큼 전송량이 계속 쌓여 무료 한도(egress)를 초과했습니다.
 *
 * 변경 내용
 *  1) 실시간 이벤트가 오면 전체 재조회 대신, 이벤트에 담긴 "바뀐 행 1개"만
 *     로컬 캐시에 반영합니다.
 *  2) 폴백 폴링 30초 → 10분, 그리고 브라우저 탭이 숨겨져 있으면 폴링하지 않습니다.
 *     (탭이 다시 보이면 1회 재조회)
 *  3) 짧은 시간에 몰린 재조회는 1회로 합칩니다(디바운스).
 */
(function () {
  "use strict";

  const POLL_MS = 10 * 60 * 1000; // 10분 (Realtime 미동작 시 안전망)
  const DEBOUNCE_MS = 800;

  function applyFilter(q, f) {
    switch (f.op) {
      case ">=": return q.gte(f.field, f.value);
      case "<=": return q.lte(f.field, f.value);
      case ">":  return q.gt(f.field, f.value);
      case "<":  return q.lt(f.field, f.value);
      case "!=": return q.neq(f.field, f.value);
      default:   return q.eq(f.field, f.value);
    }
  }

  function matchFilter(row, f) {
    const v = row ? row[f.field] : undefined;
    switch (f.op) {
      case ">=": return v >= f.value;
      case "<=": return v <= f.value;
      case ">":  return v > f.value;
      case "<":  return v < f.value;
      case "!=": return v != f.value;
      default:   return v == f.value;
    }
  }

  // 폴링 + 탭 복귀 시 재조회 + 디바운스를 묶은 공통 스케줄러
  function makeRefresher(fetchFn) {
    let stopped = false, debounceTimer = null;
    const run = () => { if (!stopped) fetchFn(); };
    const debounced = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(run, DEBOUNCE_MS);
    };
    const pollTimer = setInterval(() => { if (!document.hidden) run(); }, POLL_MS);
    let hiddenSince = 0;
    const onVis = () => {
      if (document.hidden) { hiddenSince = Date.now(); return; }
      if (hiddenSince && Date.now() - hiddenSince > 60 * 1000) run(); // 1분 이상 숨겨졌다 돌아오면 1회 갱신
      hiddenSince = 0;
    };
    document.addEventListener("visibilitychange", onVis);
    return {
      run, debounced,
      isStopped: () => stopped,
      stop() {
        stopped = true;
        clearInterval(pollTimer);
        clearTimeout(debounceTimer);
        document.removeEventListener("visibilitychange", onVis);
      },
    };
  }

  function createSupaAdapter(supabase) {
    function configDoc(key) {
      return {
        async get() {
          const { data, error } = await supabase.from("config_kv").select("value").eq("key", key).maybeSingle();
          if (error) throw error;
          return { exists: !!data, data: () => (data ? data.value : undefined) };
        },
        async set(value) {
          const { error } = await supabase.from("config_kv").upsert({ key, value, updated_at: new Date().toISOString() });
          if (error) throw error;
        },
        async delete() {
          const { error } = await supabase.from("config_kv").delete().eq("key", key);
          if (error) throw error;
        },
        onSnapshot(cb, errCb) {
          let r;
          const emit = async () => {
            try { const snap = await configDoc(key).get(); if (!r.isStopped()) cb(snap); }
            catch (e) { if (errCb) errCb(e); }
          };
          r = makeRefresher(emit);
          emit();
          const channel = supabase
            .channel("cfg_" + key)
            .on("postgres_changes", { event: "*", schema: "public", table: "config_kv", filter: `key=eq.${key}` }, (p) => {
              if (r.isStopped()) return;
              if (p.eventType === "DELETE") cb({ exists: false, data: () => undefined });
              else if (p.new && p.new.value !== undefined) cb({ exists: true, data: () => p.new.value });
              else r.debounced();
            })
            .subscribe();
          return () => { r.stop(); supabase.removeChannel(channel); };
        },
      };
    }

    function rowDoc(table, id) {
      return {
        async get() {
          const { data, error } = await supabase.from(table).select("*").eq("id", id).maybeSingle();
          if (error) throw error;
          return { exists: !!data, data: () => data || undefined };
        },
        async set(payload) {
          const row = Object.assign({ id }, payload);
          const { error } = await supabase.from(table).upsert(row);
          if (error) throw error;
        },
        async delete() {
          const { error } = await supabase.from(table).delete().eq("id", id);
          if (error) throw error;
        },
        onSnapshot(cb, errCb) {
          let r;
          const emit = async () => {
            try { const snap = await rowDoc(table, id).get(); if (!r.isStopped()) cb(snap); }
            catch (e) { if (errCb) errCb(e); }
          };
          r = makeRefresher(emit);
          emit();
          const channel = supabase
            .channel(table + "_" + id)
            .on("postgres_changes", { event: "*", schema: "public", table, filter: `id=eq.${id}` }, (p) => {
              if (r.isStopped()) return;
              if (p.eventType === "DELETE") cb({ exists: false, data: () => undefined });
              else if (p.new && p.new.id) { const row = p.new; cb({ exists: true, data: () => row }); }
              else r.debounced();
            })
            .subscribe();
          return () => { r.stop(); supabase.removeChannel(channel); };
        },
      };
    }

    function collectionQuery(table, filters) {
      filters = filters || [];
      const self = {
        where(field, op, value) {
          return collectionQuery(table, filters.concat([{ field, op, value }]));
        },
        async get() {
          let q = supabase.from(table).select("*");
          filters.forEach((f) => { q = applyFilter(q, f); });
          const { data, error } = await q;
          if (error) throw error;
          return { docs: (data || []).map((row) => ({ id: row.id, data: () => row })) };
        },
        onSnapshot(cb, errCb) {
          const cache = new Map();
          let r;
          const emitCache = () => {
            if (r.isStopped()) return;
            cb({ docs: Array.from(cache.values()).map((row) => ({ id: row.id, data: () => row })) });
          };
          const refetch = async () => {
            try {
              const snap = await self.get();
              cache.clear();
              snap.docs.forEach((d) => cache.set(d.id, d.data()));
              emitCache();
            } catch (e) { if (errCb) errCb(e); }
          };
          r = makeRefresher(refetch);
          refetch();
          const channel = supabase
            .channel(table + "_watch_" + Math.random().toString(36).slice(2))
            .on("postgres_changes", { event: "*", schema: "public", table }, (p) => {
              if (r.isStopped()) return;
              if (p.eventType === "DELETE") {
                const oldId = p.old && p.old.id;
                if (oldId && cache.delete(oldId)) emitCache();
                return;
              }
              const row = p.new;
              if (!row || !row.id) { r.debounced(); return; }
              const inRange = filters.every((f) => matchFilter(row, f));
              if (inRange) cache.set(row.id, row);
              else if (!cache.delete(row.id)) return; // 다른 달/범위 밖 변경 → 무시(재조회 안 함)
              emitCache();
            })
            .subscribe();
          return () => { r.stop(); supabase.removeChannel(channel); };
        },
      };
      return self;
    }

    return {
      doc(path) {
        const parts = path.split("/");
        if (parts[0] === "config") return configDoc(parts[1]);
        return rowDoc(parts[0], parts[1]);
      },
      collection(table) {
        return collectionQuery(table, []);
      },
    };
  }

  window.createSupaAdapter = createSupaAdapter;
})();
