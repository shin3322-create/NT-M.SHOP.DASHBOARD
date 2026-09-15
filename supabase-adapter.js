/*
 * supabase-adapter.js
 *
 * 기존 클로드 아티팩트 버전이 쓰던 db.doc()/db.collection() 형태의 API를
 * 그대로 흉내내는 얇은 어댑터입니다. 이 파일 덕분에 dashboard.html 안의
 * 렌더링/집계/폼 로직은 거의 손대지 않고 그대로 재사용할 수 있습니다.
 *
 * 실시간 반영은 Supabase Realtime(postgres_changes) 구독 + 30초 폴백 폴링을
 * 함께 사용합니다. Realtime을 안 켜도(=schema.sql의 8번을 실행 안 해도)
 * 30초 안에는 항상 최신 상태로 갱신됩니다.
 */
(function () {
  "use strict";

  const POLL_MS = 30000;

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
          let stopped = false;
          const emit = async () => {
            try { const snap = await configDoc(key).get(); if (!stopped) cb(snap); }
            catch (e) { if (errCb) errCb(e); }
          };
          emit();
          const channel = supabase
            .channel("cfg_" + key)
            .on("postgres_changes", { event: "*", schema: "public", table: "config_kv", filter: `key=eq.${key}` }, emit)
            .subscribe();
          const timer = setInterval(emit, POLL_MS);
          return () => { stopped = true; clearInterval(timer); supabase.removeChannel(channel); };
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
          let stopped = false;
          const emit = async () => {
            try { const snap = await rowDoc(table, id).get(); if (!stopped) cb(snap); }
            catch (e) { if (errCb) errCb(e); }
          };
          emit();
          const channel = supabase
            .channel(table + "_" + id)
            .on("postgres_changes", { event: "*", schema: "public", table, filter: `id=eq.${id}` }, emit)
            .subscribe();
          const timer = setInterval(emit, POLL_MS);
          return () => { stopped = true; clearInterval(timer); supabase.removeChannel(channel); };
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
          let stopped = false;
          const emit = async () => {
            try { const snap = await self.get(); if (!stopped) cb(snap); }
            catch (e) { if (errCb) errCb(e); }
          };
          emit();
          const channel = supabase
            .channel(table + "_watch_" + Math.random().toString(36).slice(2))
            .on("postgres_changes", { event: "*", schema: "public", table }, emit)
            .subscribe();
          const timer = setInterval(emit, POLL_MS);
          return () => { stopped = true; clearInterval(timer); supabase.removeChannel(channel); };
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
