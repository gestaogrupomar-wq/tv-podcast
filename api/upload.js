// Autoriza o navegador a mandar o arquivo direto para o Vercel Blob (não passa pela função,
// que tem limite de 4,5 MB por requisição).
const { handleUpload } = require("@vercel/blob/client");
const { MAX_BYTES, TIPOS, json, exigirLogin } = require("./_lib");

module.exports = async (req, res) => {
  if (req.method !== "POST") return json(res, 405, {});
  if (!exigirLogin(req, res)) return;
  try {
    const r = await handleUpload({
      body: req.body,
      request: req,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: TIPOS,
        maximumSizeInBytes: MAX_BYTES,
        addRandomSuffix: true,
      }),
    });
    json(res, 200, r);
  } catch (e) {
    json(res, 400, { erro: e.message });
  }
};
