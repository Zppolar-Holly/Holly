/**
 * Unico ponto de saida para chamadas HTTP a API do Discord.
 * - Fila serial (evita rajadas paralelas)
 * - Em 429: respeita Retry-After e pausa novas chamadas ate o fim da pausa
 * - Sem retry automatico na mesma tarefa (code OAuth so pode ser trocado uma vez)
 */

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function parseRetryAfterSeconds(response) {
    const raw = response?.headers?.['retry-after'];
    if (raw == null || raw === '') return 5;
    const n = Number(raw);
    if (Number.isFinite(n)) return Math.min(Math.max(Math.ceil(n), 1), 3600);
    return 5;
}

let pauseUntil = 0;
/** @type {Promise<unknown>} */
let chain = Promise.resolve();

function getPauseUntil() {
    return pauseUntil;
}

/**
 * Enfileira uma função que retorna uma Promise (ex.: axios.get).
 * Não reexecuta em caso de erro;429 apenas atualiza pause global e propaga o erro.
 */
function enqueueDiscordTask(task) {
    const run = async () => {
        const now = Date.now();
        if (now < pauseUntil) {
            const wait = pauseUntil - now;
            console.warn(`[Discord] Pausa global ativa — aguardando ${wait}ms antes da próxima chamada`);
            await sleep(wait);
        }

        try {
            return await task();
        } catch (err) {
            if (err?.response?.status === 429) {
                const sec = parseRetryAfterSeconds(err.response);
                pauseUntil = Date.now() + sec * 1000;
                console.warn(`[Discord] 429 — pausa global de ${sec}s (sem retry automático nesta tarefa)`);
            }
            throw err;
        }
    };

    const next = chain.then(run, run);
    chain = next.catch(() => {});
    return next;
}

module.exports = {
    enqueueDiscordTask,
    getPauseUntil,
    parseRetryAfterSeconds
};
