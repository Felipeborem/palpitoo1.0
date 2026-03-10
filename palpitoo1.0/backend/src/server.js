require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
console.log("Tentando conectar ao banco...");
console.log("Host carregado:", process.env.DATABASE_URL ? "Sim" : "Não");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Rota de teste
app.get('/', (req, res) => {
  res.send('RODANDO PORRAAAAA');
});

// -----------------------------------------------------------------------------
// ROTA DE CADASTRO 
app.post('/cadastro', async (req, res) => {
  try {
    const { nome, email, senha, time_favorito, foto_perfil } = req.body; 

    const resultado = await pool.query(
      'INSERT INTO usuarios (nome, email, senha, time_favorito, foto_perfil) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [nome, email, senha, time_favorito, foto_perfil]
    );

    res.status(201).json({ 
      mensagem: 'Usuário cadastrado!', 
      usuario: resultado.rows[0] 
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao salvar no banco de dados.' });
  }
});

// -----------------------------------------------------------------------------
// ROTA DE LOGIN
app.post('/login', async (req, res) => {
  try {
    const { email, senha } = req.body;

    const resultado = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);

    if (resultado.rows.length === 0) {
      return res.status(401).json({ erro: 'E-mail ou senha incorretos.' });
    }

    const usuario = resultado.rows[0];

    if (usuario.senha !== senha) {
      return res.status(401).json({ erro: 'E-mail ou senha incorretos.' });
    }

    res.json({
      mensagem: 'Login bem-sucedido!',
      usuario: { 
        id: usuario.id, 
        nome: usuario.nome, 
        email: usuario.email, 
        time: usuario.time_favorito,
        foto: usuario.foto_perfil 
      }
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro interno no servidor.' });
  }
});

// -----------------------------------------------------------------------------
// ROTA PARA BUSCAR OS JOGOS DISPONÍVEIS
app.get('/jogos', async (req, res) => {
  try {
    const resultado = await pool.query('SELECT * FROM jogos ORDER BY id_jogo ASC');
    res.json(resultado.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao buscar os jogos no banco de dados.' });
  }
});
// -----------------------------------------------------------------------------
// ROTA PARA SALVAR OU ATUALIZAR OS PALPITES (AGORA BLINDADA)
app.post('/palpites', async (req, res) => {
  try {
    const { palpites } = req.body; 

    for (const p of palpites) {
      // 1. Verifica no banco se o jogo ainda está 'andamento'
      const jogoInfo = await pool.query('SELECT status FROM jogos WHERE id_jogo = $1', [p.id_jogo]);
      
      if (jogoInfo.rows.length === 0) continue; // Jogo não existe
      
      // Se o jogo já estiver rolando ou encerrado, ignora esse palpite específico
      if (jogoInfo.rows[0].status !== 'andamento') {
        console.log(`Tentativa de palpite bloqueada para o jogo ${p.id_jogo} (Status: ${jogoInfo.rows[0].status})`);
        continue; 
      }

      // 2. Se estiver tudo certo ('andamento'), salva no banco
      await pool.query(
        `INSERT INTO palpites (usuario_id, jogo_id, gols_casa_palpite, gols_fora_palpite) 
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (usuario_id, jogo_id) 
         DO UPDATE SET 
            gols_casa_palpite = EXCLUDED.gols_casa_palpite, 
            gols_fora_palpite = EXCLUDED.gols_fora_palpite`,
        // ✅ CORREÇÃO: Garantir que id_usuario é número (localStorage envia string)
        [Number(p.id_usuario), p.id_jogo, p.gols_casa, p.gols_fora]
      );
    }

    res.json({ mensagem: 'Palpites validados e salvos com sucesso!' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao salvar os palpites no banco de dados.' });
  }
});
// -----------------------------------------------------------------------------
// ROTA PARA BUSCAR OS PALPITES SALVOS DE UM USUÁRIO
app.get('/meus-palpites/:id_usuario', async (req, res) => {
  try {
    const { id_usuario } = req.params; 

    const resultado = await pool.query(
      'SELECT * FROM palpites WHERE usuario_id = $1',
      [id_usuario]
    );

    res.json(resultado.rows); 
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao buscar os palpites do usuário.' });
  }
});

// -----------------------------------------------------------------------------
// -----------------------------------------------------------------------------
// ROTA PARA ATUALIZAR A FOTO DE PERFIL
app.put('/atualizar-foto', async (req, res) => {
  try {
    const { email, foto_base64 } = req.body;

    const resultado = await pool.query(
      'UPDATE usuarios SET foto_perfil = $1 WHERE email = $2 RETURNING *',
      [foto_base64, email]
    );

    res.json({ 
      mensagem: 'Foto atualizada com sucesso!', 
      usuario: resultado.rows[0] 
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao salvar a foto no banco.' });
  }
});

// -----------------------------------------------------------------------------
// ROTA PARA BUSCAR O RANKING GERAL (NOVA ROTA ADICIONADA!)
app.get('/ranking', async (req, res) => {
  try {
    const resultado = await pool.query(`
      SELECT 
        u.nome, 
        u.time_favorito, 
        COALESCE(SUM(p.pontos_obtidos), 0) AS total_pontos
      FROM usuarios u
      LEFT JOIN palpites p ON u.id = p.usuario_id
      GROUP BY u.id, u.nome, u.time_favorito
      ORDER BY total_pontos DESC
    `);

    res.json(resultado.rows);
  } catch (err) {
    console.error("Erro ao gerar ranking:", err);
    res.status(500).json({ erro: 'Erro ao gerar o ranking de jogadores.' });
  }
});

// -----------------------------------------------------------------------------
// ROTA PARA CRIAR UMA NOVA LIGA
app.post('/criar-liga', async (req, res) => {
  try {
    const { nome_liga, dono_id, id_dono, total_rodadas, rodada_inicial } = req.body;
    const donoCerto = dono_id || id_dono;

    // Gera um código aleatório de 6 letras/números (Ex: X7B9KQ)
    const codigo_convite = Math.random().toString(36).substring(2, 8).toUpperCase();

    // Número de rodadas (padrão: ilimitado = null)
    const totalRodadasVal = total_rodadas ? parseInt(total_rodadas) : null;
    const rodadaInicialVal = rodada_inicial ? parseInt(rodada_inicial) : 1;

    // 1. Salva a liga nova no banco com total_rodadas e rodada_inicial
    const novaLiga = await pool.query(
      `INSERT INTO ligas (nome, codigo_convite, dono_id, total_rodadas, rodada_inicial, status)
       VALUES ($1, $2, $3, $4, $5, 'ativa') RETURNING *`,
      [nome_liga, codigo_convite, donoCerto, totalRodadasVal, rodadaInicialVal]
    );

    const idLigaGerada = novaLiga.rows[0].id_liga;

    // 2. Coloca o dono automaticamente dentro da liga que ele acabou de criar
    await pool.query(
      'INSERT INTO usuarios_ligas (liga_id, usuario_id) VALUES ($1, $2)',
      [idLigaGerada, donoCerto]
    );

    res.status(201).json({ 
      mensagem: 'Liga criada com sucesso!', 
      liga: novaLiga.rows[0] 
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao criar a liga.' });
  }
});

// -----------------------------------------------------------------------------
// ROTA PARA ENTRAR EM UMA LIGA USANDO O CÓDIGO
app.post('/entrar-liga', async (req, res) => {
  try {
    const { codigo_convite, id_usuario, usuario_id } = req.body;
    const usuarioCerto = id_usuario || usuario_id;

    // 1. Verifica se a liga com esse código existe
    const buscaLiga = await pool.query('SELECT * FROM ligas WHERE codigo_convite = $1', [codigo_convite]);
    
    if (buscaLiga.rows.length === 0) {
      return res.status(404).json({ erro: 'Liga não encontrada. Verifique o código!' });
    }

    const liga_id = buscaLiga.rows[0].id_liga;

    // 2. Tenta colocar o usuário na liga
    await pool.query(
      'INSERT INTO usuarios_ligas (liga_id, usuario_id) VALUES ($1, $2)',
      [liga_id, usuarioCerto]
    );

    res.json({ mensagem: `Bem-vindo à liga ${buscaLiga.rows[0].nome}!` });

  } catch (err) {
    // Se der erro de "duplicate key", é porque ele já está na liga
    if (err.code === '23505') {
      return res.status(400).json({ erro: 'Você já participa desta liga, craque!' });
    }
    console.error(err);
    res.status(500).json({ erro: 'Erro ao entrar na liga.' });
  }
});

// -----------------------------------------------------------------------------
// ROTA PARA BUSCAR AS LIGAS QUE O USUÁRIO PARTICIPA
app.get('/minhas-ligas/:usuario_id', async (req, res) => {
  try {
    const { usuario_id } = req.params;

    const resultado = await pool.query(`
      SELECT l.id_liga, l.nome, l.codigo_convite, l.dono_id,
             l.total_rodadas, l.rodada_inicial, l.status,
             (SELECT COUNT(*) FROM usuarios_ligas ul2 WHERE ul2.liga_id = l.id_liga) AS total_participantes
      FROM ligas l
      JOIN usuarios_ligas ul ON l.id_liga = ul.liga_id
      WHERE ul.usuario_id = $1
    `, [usuario_id]);

    res.json(resultado.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao buscar suas ligas.' });
  }
});

// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// -----------------------------------------------------------------------------
// ROTA PARA BUSCAR O RANKING DE UMA LIGA PRIVADA ESPECÍFICA
app.get('/ranking-liga/:id_liga', async (req, res) => {
  try {
    const { id_liga } = req.params;
    
    // 1. Busca os pontos só da galera que tá nessa liga
    // ✅ CORREÇÃO: filtra por rodadas da liga (rodada_inicial até rodada_inicial + total_rodadas - 1)
    const ligaMeta = await pool.query('SELECT rodada_inicial, total_rodadas FROM ligas WHERE id_liga = $1', [id_liga]);
    const meta = ligaMeta.rows[0] || {};
    const rodadaIni = meta.rodada_inicial || 1;
    const rodadaFim = meta.total_rodadas ? rodadaIni + meta.total_rodadas - 1 : 99999;

    const resultado = await pool.query(`
      SELECT 
        u.id,
        u.nome, 
        u.time_favorito, 
        COALESCE(SUM(p.pontos_obtidos), 0) AS total_pontos
      FROM usuarios u
      JOIN usuarios_ligas ul ON u.id = ul.usuario_id
      LEFT JOIN palpites p ON u.id = p.usuario_id
      LEFT JOIN jogos j ON j.id_jogo = p.jogo_id
        AND j.rodada BETWEEN $2 AND $3
      WHERE ul.liga_id = $1
      GROUP BY u.id, u.nome, u.time_favorito
      ORDER BY total_pontos DESC
    `, [id_liga, rodadaIni, rodadaFim]);
    
    // 2. Busca também o nome da Liga para a gente colocar no título do site
    const ligaInfo = await pool.query('SELECT nome FROM ligas WHERE id_liga = $1', [id_liga]);
    const nomeLiga = ligaInfo.rows.length > 0 ? ligaInfo.rows[0].nome : 'Liga Privada';

    res.json({ nomeLiga, ranking: resultado.rows });
  } catch (err) {
    console.error("Erro ao gerar ranking da liga:", err);
    res.status(500).json({ erro: 'Erro ao gerar o ranking da liga.' });
  }
});

// -----------------------------------------------------------------------------
// ROTA SOCIAL: ADICIONAR AMIGO
app.post('/adicionar-amigo', async (req, res) => {
  try {
    const { id_usuario, id_amigo } = req.body;
    await pool.query('INSERT INTO amigos (usuario_id, amigo_id) VALUES ($1, $2)', [id_usuario, id_amigo]);
    res.json({ mensagem: 'Amigo adicionado!' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao adicionar amigo.' });
  }
});

// -----------------------------------------------------------------------------
// ROTA SOCIAL: LISTAR AMIGOS
app.get('/meus-amigos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const resultado = await pool.query(`
      SELECT u.id, u.nome, u.time_favorito, u.foto_perfil 
      FROM usuarios u
      JOIN amigos a ON u.id = a.amigo_id
      WHERE a.usuario_id = $1
    `, [id]);
    res.json(resultado.rows);
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao listar amigos.' });
  }
});

// -----------------------------------------------------------------------------
// ROTA SOCIAL: REMOVER AMIGO
app.delete('/remover-amigo', async (req, res) => {
  try {
    const { id_usuario, id_amigo } = req.body;
    await pool.query('DELETE FROM amigos WHERE usuario_id = $1 AND amigo_id = $2', [id_usuario, id_amigo]);
    res.json({ mensagem: 'Amigo removido.' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao remover amigo.' });
  }
});


// -----------------------------------------------------------------------------
// ROTA PARA BUSCAR A LIGA DE UM USUÁRIO (usada pelo minhaliga.html)
app.get('/minha-liga/:id_usuario', async (req, res) => {
  try {
    const { id_usuario } = req.params;
    const resultado = await pool.query(`
      SELECT l.id_liga, l.nome, l.codigo_convite, l.dono_id,
             l.total_rodadas, l.rodada_inicial, l.status, l.data_encerramento,
             l.resumo_encerramento,
             l.criado_em
      FROM ligas l
      JOIN usuarios_ligas ul ON l.id_liga = ul.liga_id
      WHERE ul.usuario_id = $1
      LIMIT 1
    `, [id_usuario]);

    if (resultado.rows.length === 0) {
      return res.status(404).json({ erro: 'Usuário não está em nenhuma liga.' });
    }

    res.json({ liga: resultado.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao buscar liga do usuário.' });
  }
});

// -----------------------------------------------------------------------------
// ROTA PARA BUSCAR UMA LIGA PELO ID (usada pelo minhaliga.html?id=X)
app.get('/liga/:id_liga', async (req, res) => {
  try {
    const { id_liga } = req.params;
    const resultado = await pool.query(
      `SELECT *, 
              resumo_encerramento
       FROM ligas WHERE id_liga = $1`,
      [id_liga]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({ erro: 'Liga não encontrada.' });
    }

    res.json({ liga: resultado.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao buscar liga.' });
  }
});

// (rota /sair-liga definida abaixo com filtro correto por liga_id)

// -----------------------------------------------------------------------------
// ROTA PARA BUSCAR PALPITES DA GALERA EM UMA LIGA (usada pelo minhaliga.html)
app.get('/palpites-liga/:id_liga', async (req, res) => {
  try {
    const { id_liga } = req.params;
    const resultado = await pool.query(`
      SELECT
        p.id_palpite,
        p.usuario_id    AS id_usuario,
        p.gols_casa_palpite AS gols_casa,
        p.gols_fora_palpite AS gols_fora,
        p.pontos_obtidos,
        u.nome,
        u.foto_perfil,
        j.status,
        CONCAT(j.time_casa, ' x ', j.time_fora) AS jogo
      FROM palpites p
      JOIN usuarios u  ON u.id  = p.usuario_id
      JOIN jogos j     ON j.id_jogo = p.jogo_id
      JOIN usuarios_ligas ul ON ul.usuario_id = p.usuario_id
      WHERE ul.liga_id = $1
      ORDER BY j.id_jogo ASC, u.nome ASC
    `, [id_liga]);

    res.json(resultado.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao buscar palpites da liga.' });
  }
});


// -----------------------------------------------------------------------------
// ROTA SOCIAL: SEGUIR UM PALPITEIRO
app.post('/seguir', async (req, res) => {
  try {
    const { seguidor_id, seguido_id } = req.body;
    if (String(seguidor_id) === String(seguido_id)) {
      return res.status(400).json({ erro: 'Você não pode seguir a si mesmo!' });
    }
    await pool.query(
      'INSERT INTO seguidores (seguidor_id, seguido_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [seguidor_id, seguido_id]
    );
    res.json({ mensagem: 'Palpiteiro seguido!' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao seguir palpiteiro.' });
  }
});

// -----------------------------------------------------------------------------
// ROTA SOCIAL: DEIXAR DE SEGUIR
app.delete('/deixar-seguir', async (req, res) => {
  try {
    const { seguidor_id, seguido_id } = req.body;
    await pool.query(
      'DELETE FROM seguidores WHERE seguidor_id = $1 AND seguido_id = $2',
      [seguidor_id, seguido_id]
    );
    res.json({ mensagem: 'Deixou de seguir.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao deixar de seguir.' });
  }
});

// -----------------------------------------------------------------------------
// ROTA SOCIAL: BUSCAR QUEM O USUÁRIO SEGUE
app.get('/seguindo/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const resultado = await pool.query(`
      SELECT
        u.id,
        u.nome,
        u.time_favorito,
        u.foto_perfil,
        COALESCE(SUM(p.pontos_obtidos), 0) AS total_pontos,
        (SELECT l.nome FROM ligas l
         JOIN usuarios_ligas ul ON l.id_liga = ul.liga_id
         WHERE ul.usuario_id = u.id LIMIT 1) AS liga_atual
      FROM seguidores s
      JOIN usuarios u ON u.id = s.seguido_id
      LEFT JOIN palpites p ON p.usuario_id = u.id
      WHERE s.seguidor_id = $1
      GROUP BY u.id, u.nome, u.time_favorito, u.foto_perfil
      ORDER BY u.nome ASC
    `, [id]);
    res.json(resultado.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao buscar seguindo.' });
  }
});

// -----------------------------------------------------------------------------
// ROTA SOCIAL: PERFIL PÚBLICO DE UM PALPITEIRO
app.get('/perfil-publico/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Dados básicos do usuário
    const usuario = await pool.query(
      'SELECT id, nome, email, time_favorito, foto_perfil, criado_em FROM usuarios WHERE id = $1',
      [id]
    );
    if (!usuario.rows.length) return res.status(404).json({ erro: 'Usuário não encontrado.' });

    // Estatísticas gerais
    const stats = await pool.query(`
      SELECT
        COUNT(*)                                            AS total_palpites,
        COUNT(*) FILTER (WHERE pontos_obtidos = 3)         AS acertos_exatos,
        COUNT(*) FILTER (WHERE pontos_obtidos = 1)         AS acertos_vencedor,
        COUNT(*) FILTER (WHERE pontos_obtidos = 0
                           AND pontos_obtidos IS NOT NULL) AS erros,
        COALESCE(SUM(pontos_obtidos), 0)                   AS total_pontos
      FROM palpites
      WHERE usuario_id = $1
    `, [id]);

    // Liga atual
    const ligaAtual = await pool.query(`
      SELECT l.id_liga, l.nome, l.codigo_convite
      FROM ligas l
      JOIN usuarios_ligas ul ON l.id_liga = ul.liga_id
      WHERE ul.usuario_id = $1
      LIMIT 1
    `, [id]);

    // Últimos 10 palpites com resultado do jogo
    const palpitesRecentes = await pool.query(`
      SELECT
        p.gols_casa_palpite,
        p.gols_fora_palpite,
        p.pontos_obtidos,
        j.time_casa,
        j.time_fora,
        j.gols_casa_real,
        j.gols_fora_real,
        j.status,
        j.rodada,
        j.data_jogo
      FROM palpites p
      JOIN jogos j ON j.id_jogo = p.jogo_id
      WHERE p.usuario_id = $1
      ORDER BY j.data_jogo DESC NULLS LAST
      LIMIT 10
    `, [id]);

    // Contagem de seguidores e seguindo
    const seguidores = await pool.query(
      'SELECT COUNT(*) AS total FROM seguidores WHERE seguido_id = $1', [id]
    );
    const seguindo = await pool.query(
      'SELECT COUNT(*) AS total FROM seguidores WHERE seguidor_id = $1', [id]
    );

    res.json({
      usuario:          usuario.rows[0],
      stats:            stats.rows[0],
      liga_atual:       ligaAtual.rows[0] || null,
      palpites_recentes: palpitesRecentes.rows,
      seguidores:       Number(seguidores.rows[0].total),
      seguindo:         Number(seguindo.rows[0].total),
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao carregar perfil.' });
  }
});

// -----------------------------------------------------------------------------
// ROTA SOCIAL: BUSCAR USUÁRIOS POR NOME (com pontos e liga)
app.get('/buscar-usuarios', async (req, res) => {
  try {
    const { nome } = req.query;
    const resultado = await pool.query(`
      SELECT
        u.id,
        u.nome,
        u.time_favorito,
        u.foto_perfil,
        COALESCE(SUM(p.pontos_obtidos), 0) AS total_pontos,
        (SELECT l.nome FROM ligas l
         JOIN usuarios_ligas ul ON l.id_liga = ul.liga_id
         WHERE ul.usuario_id = u.id LIMIT 1) AS liga_atual
      FROM usuarios u
      LEFT JOIN palpites p ON p.usuario_id = u.id
      WHERE u.nome ILIKE $1
      GROUP BY u.id, u.nome, u.time_favorito, u.foto_perfil
      ORDER BY u.nome ASC
      LIMIT 10
    `, [`%${nome}%`]);
    res.json(resultado.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro interno na busca.' });
  }
});

// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// ROTAS LEGADAS DO PERFIL PÚBLICO (compatibilidade com versões antigas do HTML)

// GET /usuario/:id
app.get('/usuario/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const usuario = await pool.query(
      'SELECT id, nome, email, time_favorito, foto_perfil, criado_em FROM usuarios WHERE id = $1', [id]
    );
    if (!usuario.rows.length) return res.status(404).json({ erro: 'Usuário não encontrado.' });

    const stats = await pool.query(`
      SELECT
        COUNT(*)                                            AS total_palpites,
        COUNT(*) FILTER (WHERE pontos_obtidos = 3)         AS acertos_exatos,
        COUNT(*) FILTER (WHERE pontos_obtidos = 1)         AS acertos_vencedor,
        COUNT(*) FILTER (WHERE pontos_obtidos = 0
                           AND pontos_obtidos IS NOT NULL) AS erros,
        COALESCE(SUM(pontos_obtidos), 0)                   AS total_pontos
      FROM palpites WHERE usuario_id = $1
    `, [id]);

    const seguidores = await pool.query('SELECT COUNT(*) AS total FROM seguidores WHERE seguido_id  = $1', [id]);
    const seguindo   = await pool.query('SELECT COUNT(*) AS total FROM seguidores WHERE seguidor_id = $1', [id]);
    const ligaAtual  = await pool.query(`
      SELECT l.id_liga, l.nome FROM ligas l
      JOIN usuarios_ligas ul ON l.id_liga = ul.liga_id
      WHERE ul.usuario_id = $1 LIMIT 1
    `, [id]);

    res.json({
      ...usuario.rows[0],
      ...stats.rows[0],
      seguidores: Number(seguidores.rows[0].total),
      seguindo:   Number(seguindo.rows[0].total),
      liga_atual: ligaAtual.rows[0] || null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao buscar usuário.' });
  }
});

// GET /desempenho/:id
app.get('/desempenho/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const resultado = await pool.query(`
      SELECT
        COUNT(*)                                            AS total_palpites,
        COUNT(*) FILTER (WHERE pontos_obtidos = 3)         AS acertos_exatos,
        COUNT(*) FILTER (WHERE pontos_obtidos = 1)         AS acertos_vencedor,
        COUNT(*) FILTER (WHERE pontos_obtidos = 0
                           AND pontos_obtidos IS NOT NULL) AS erros,
        COALESCE(SUM(pontos_obtidos), 0)                   AS total_pontos
      FROM palpites WHERE usuario_id = $1
    `, [id]);
    res.json(resultado.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao buscar desempenho.' });
  }
});

// GET /carreira/:id
app.get('/carreira/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const ligas = await pool.query(`
      SELECT l.id_liga, l.nome, l.codigo_convite
      FROM ligas l
      JOIN usuarios_ligas ul ON l.id_liga = ul.liga_id
      WHERE ul.usuario_id = $1
    `, [id]);
    res.json({ ligas: ligas.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao buscar carreira.' });
  }
});

// GET /ultimos-palpites/:id
app.get('/ultimos-palpites/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const resultado = await pool.query(`
      SELECT
        p.gols_casa_palpite,
        p.gols_fora_palpite,
        p.pontos_obtidos,
        j.time_casa,
        j.time_fora,
        j.gols_casa_real,
        j.gols_fora_real,
        j.status,
        j.rodada,
        j.data_jogo
      FROM palpites p
      JOIN jogos j ON j.id_jogo = p.jogo_id
      WHERE p.usuario_id = $1
      ORDER BY j.data_jogo DESC NULLS LAST
      LIMIT 10
    `, [id]);
    res.json(resultado.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao buscar palpites.' });
  }
});

// -----------------------------------------------------------------------------
/// =========================================================================
// ROTA: ATUALIZAR PERFIL (TIME DO CORAÇÃO)
// =========================================================================
app.put('/atualizar-perfil', async (req, res) => {
  try {
    const { id, time_favorito } = req.body;

    // 1. Validação básica de segurança
    if (!id || !time_favorito) {
      return res.status(400).json({ erro: 'ID do usuário e time favorito são obrigatórios.' });
    }

    // 2. Comando SQL para atualizar apenas a coluna 'time_favorito' do usuário logado
    // O "RETURNING *" faz o banco devolver os dados atualizados para confirmarmos
    const resultado = await pool.query(
      `UPDATE usuarios 
       SET time_favorito = $1 
       WHERE id = $2 
       RETURNING *`,
      [time_favorito, id]
    );

    // 3. Verifica se o usuário realmente existe no banco
    if (resultado.rowCount === 0) {
      return res.status(404).json({ erro: 'Usuário não encontrado no banco de dados.' });
    }

    // 4. Responde de volta para o seu perfil.html
    res.json({ 
      mensagem: 'Perfil atualizado com sucesso no banco de dados!', 
      usuario: resultado.rows[0] 
    });

  } catch (err) {
    console.error("Erro ao atualizar perfil:", err);
    res.status(500).json({ erro: 'Erro interno no servidor ao tentar salvar o time.' });
  }
});

// =========================================================================
// ROTA: BUSCAR LIGAS DISPONÍVEIS (Que o usuário ainda não está)
// =========================================================================
app.get('/ligas-disponiveis/:usuario_id', async (req, res) => {
  try {
    const { usuario_id } = req.params;
    
    const resultado = await pool.query(
      `SELECT 
         l.id_liga,
         l.nome,
         l.codigo_convite,
         l.dono_id,
         l.total_rodadas,
         l.rodada_inicial,
         l.status,
         u.nome AS nome_dono,
         COUNT(ul2.usuario_id) AS total_membros
       FROM ligas l
       LEFT JOIN usuarios u ON u.id = l.dono_id
       LEFT JOIN usuarios_ligas ul2 ON ul2.liga_id = l.id_liga
       WHERE l.id_liga NOT IN (
         SELECT liga_id FROM usuarios_ligas WHERE usuario_id = $1
       )
       GROUP BY l.id_liga, l.nome, l.codigo_convite, l.dono_id, l.total_rodadas,
                l.rodada_inicial, l.status, u.nome
       ORDER BY total_membros DESC
       LIMIT 30`, 
      [usuario_id]
    );

    res.json(resultado.rows);
  } catch (err) {
    console.error("Erro ao buscar ligas disponíveis:", err);
    res.status(500).json({ erro: 'Erro ao buscar a vitrine de ligas no banco.' });
  }
});


// =========================================================================
// ROTA: ENTRAR NA LIGA PELO CLIQUE (Usando o ID direto)
// =========================================================================
app.post('/entrar-liga-clique', async (req, res) => {
  try {
    const { liga_id, usuario_id } = req.body;

    // 1. Verifica se ele já está na liga por segurança
    const jaEsta = await pool.query(
      'SELECT * FROM usuarios_ligas WHERE liga_id = $1 AND usuario_id = $2', 
      [liga_id, usuario_id]
    );
    if (jaEsta.rows.length > 0) {
      return res.status(400).json({ erro: 'Você já está participando desta liga!' });
    }

    // 2. Insere o craque na liga
    await pool.query(
      'INSERT INTO usuarios_ligas (liga_id, usuario_id) VALUES ($1, $2)', 
      [liga_id, usuario_id]
    );

    res.json({ mensagem: 'Parabéns! Você entrou na liga com sucesso! ⚽' });
  } catch (err) {
    console.error("Erro ao entrar na liga:", err);
    res.status(500).json({ erro: 'Erro interno ao tentar entrar na liga.' });
  }
});

// (rota /entrar-liga já definida acima com codigo_convite correto)

// (rota /minhas-ligas já definida acima com id_liga correto)


// -----------------------------------------------------------------------------
// ROTA PARA SAIR DE UMA LIGA
app.post('/sair-liga', async (req, res) => {
  try {
    const { liga_id, usuario_id } = req.body;

    // Remove o usuário da liga
    const deletar = await pool.query(
      'DELETE FROM usuarios_ligas WHERE liga_id = $1 AND usuario_id = $2 RETURNING *',
      [liga_id, usuario_id]
    );

    if (deletar.rows.length === 0) {
      return res.status(400).json({ erro: 'Você não faz parte desta liga ou ela não existe.' });
    }

    res.json({ mensagem: 'Você saiu da liga com sucesso!' });

  } catch (err) {
    console.error("Erro ao sair da liga:", err);
    res.status(500).json({ erro: 'Erro interno ao tentar sair da liga.' });
  }
});

// -----------------------------------------------------------------------------
// -----------------------------------------------------------------------------
// JOB AUTOMÁTICO: muda status para 'aovivo' quando data_jogo for ultrapassada
// Roda a cada 30 segundos
// REGRA: 
//   - 'andamento'  → palpites ABERTOS (jogo ainda não começou)
//   - 'aovivo'     → palpites BLOQUEADOS (data_jogo foi atingida / jogo em curso)
//   - 'finalizado' → jogo encerrado com placar real registrado
// -----------------------------------------------------------------------------
async function iniciarJogosAutomaticamente() {
  try {
    // Muda para 'aovivo' SOMENTE quando o timestamp do jogo for ultrapassado
    // e o jogo ainda estiver em 'andamento' (aguardando início)
    const query = `
      UPDATE jogos 
      SET status = 'aovivo' 
      WHERE status = 'andamento' 
        AND data_jogo IS NOT NULL 
        AND data_jogo <= NOW()
      RETURNING id_jogo, time_casa, time_fora, rodada, data_jogo;
    `;

    const resultado = await pool.query(query);

    if (resultado.rowCount > 0) {
      resultado.rows.forEach(jogo => {
        console.log(`🔴 [AUTO] Palpites bloqueados! ${jogo.time_casa} x ${jogo.time_fora} (Rodada ${jogo.rodada}) — jogo iniciado em ${new Date(jogo.data_jogo).toLocaleString('pt-BR')}`);
      });
    }

  } catch (err) {
    console.error('Erro no job de inicio de jogos:', err.message);
  }
}

// Dispara ao subir o servidor e a cada 30 segundos
iniciarJogosAutomaticamente();
setInterval(iniciarJogosAutomaticamente, 30 * 1000);

// =============================================================================
// ROTA: RODADA ATUAL — calcula qual rodada está ativa com base nos jogos reais
// Prioridade: 1) rodada com jogo 'aovivo', 2) menor rodada com jogo não finalizado
// 3) maior rodada (todas finalizadas)
// =============================================================================
app.get('/rodada-atual', async (req, res) => {
  try {
    // Jogo ao vivo agora
    const aoVivo = await pool.query(
      `SELECT rodada FROM jogos WHERE status = 'aovivo' ORDER BY rodada ASC LIMIT 1`
    );
    if (aoVivo.rows.length > 0) {
      return res.json({ rodada_atual: Number(aoVivo.rows[0].rodada) });
    }

    // Menor rodada com jogo ainda não finalizado
    const aberta = await pool.query(
      `SELECT rodada FROM jogos WHERE status != 'finalizado' ORDER BY rodada ASC LIMIT 1`
    );
    if (aberta.rows.length > 0) {
      return res.json({ rodada_atual: Number(aberta.rows[0].rodada) });
    }

    // Fallback: maior rodada (todas finalizadas)
    const ultima = await pool.query(
      `SELECT rodada FROM jogos ORDER BY rodada DESC LIMIT 1`
    );
    const rodada = ultima.rows.length > 0 ? Number(ultima.rows[0].rodada) : 1;
    res.json({ rodada_atual: rodada });
  } catch (err) {
    console.error('Erro ao calcular rodada atual:', err);
    res.status(500).json({ erro: 'Erro ao calcular rodada atual.' });
  }
});



// =============================================================================
// ROTA: CRIAR JOGO MANUALMENTE
// POST /criar-jogo
// =============================================================================
app.post('/criar-jogo', async (req, res) => {
  try {
    const { time_casa, time_fora, rodada, data_jogo } = req.body;
    if (!time_casa || !time_fora || !rodada) {
      return res.status(400).json({ erro: 'time_casa, time_fora e rodada são obrigatórios.' });
    }
    const resultado = await pool.query(
      `INSERT INTO jogos (time_casa, time_fora, status, rodada, data_jogo)
       VALUES ($1, $2, 'andamento', $3, $4) RETURNING *`,
      [time_casa, time_fora, Number(rodada), data_jogo || null]
    );
    res.status(201).json({ mensagem: `${time_casa} x ${time_fora} criado!`, jogo: resultado.rows[0] });
  } catch (err) {
    console.error('Erro ao criar jogo:', err.message);
    res.status(500).json({ erro: 'Erro ao criar jogo.' });
  }
});

// =============================================================================
// ROTA: DELETAR JOGO
// DELETE /deletar-jogo/:id
// =============================================================================
app.delete('/deletar-jogo/:id', async (req, res) => {
  try {
    const { id } = req.params;
    // Remove palpites vinculados primeiro
    await pool.query('DELETE FROM palpites WHERE jogo_id = $1', [Number(id)]);
    const result = await pool.query('DELETE FROM jogos WHERE id_jogo = $1 RETURNING id_jogo', [Number(id)]);
    if (result.rows.length === 0) return res.status(404).json({ erro: 'Jogo não encontrado.' });
    res.json({ mensagem: 'Jogo removido com sucesso.' });
  } catch (err) {
    console.error('Erro ao deletar jogo:', err.message);
    res.status(500).json({ erro: 'Erro ao deletar jogo.' });
  }
});

// =============================================================================
// ROTA: BUSCAR JOGOS DO DIA — SportAPI (RapidAPI)
// GET /jogos-do-dia?date=YYYY-MM-DD
// Retorna TODOS os jogos de futebol do dia, incluindo Brasileirão e Libertadores
// =============================================================================
app.get('/jogos-do-dia', async (req, res) => {
  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) {
    return res.status(500).json({ erro: 'RAPIDAPI_KEY não configurada no servidor.' });
  }

  const date = req.query.date || new Date().toISOString().split('T')[0];

  try {
    const url = `https://sportapi7.p.rapidapi.com/api/v1/sport/football/scheduled-events/${date}`;
    const response = await fetch(url, {
      headers: {
        'x-rapidapi-key':  apiKey,
        'x-rapidapi-host': 'sportapi7.p.rapidapi.com'
      }
    });

    if (!response.ok) {
      console.log(`[SportAPI] retornou ${response.status}`);
      return res.status(502).json({ erro: `Erro na API externa (${response.status}).` });
    }

    const data = await response.json();
    const events = data.events || [];

    const resultados = events.map(ev => ({
      fixture_id: ev.id,
      liga_nome:  ev.tournament?.name || ev.tournament?.uniqueTournament?.name || 'Desconhecido',
      liga_id:    String(ev.tournament?.uniqueTournament?.id || ev.tournament?.id || 0),
      liga_logo:  null,
      liga_emoji: '⚽',
      time_casa:  ev.homeTeam?.shortName || ev.homeTeam?.name || '?',
      time_fora:  ev.awayTeam?.shortName || ev.awayTeam?.name || '?',
      logo_casa:  ev.homeTeam?.id ? `https://api.sofascore.app/api/v1/team/${ev.homeTeam.id}/image` : null,
      logo_fora:  ev.awayTeam?.id ? `https://api.sofascore.app/api/v1/team/${ev.awayTeam.id}/image` : null,
      data_jogo:  ev.startTimestamp ? new Date(ev.startTimestamp * 1000).toISOString() : null,
      status:     ev.status?.type === 'finished'   ? 'FT'
                : ev.status?.type === 'inprogress' ? 'LIVE'
                : 'NS',
      rodada_api: ev.roundInfo?.round ? `Rodada ${ev.roundInfo.round}` : null,
      pais:       ev.tournament?.category?.name || null,
    }));

    res.json(resultados);
  } catch (err) {
    console.error('Erro ao buscar jogos (SportAPI):', err.message);
    res.status(500).json({ erro: 'Erro ao buscar jogos externos.' });
  }
});

// =============================================================================
// ROTA: IMPORTAR JOGO SELECIONADO PARA O BANCO
// POST /importar-jogo
// Body: { time_casa, time_fora, data_jogo, rodada, fixture_id }
// =============================================================================
app.post('/importar-jogo', async (req, res) => {
  try {
    const { time_casa, time_fora, data_jogo, rodada, fixture_id } = req.body;

    if (!time_casa || !time_fora || !rodada) {
      return res.status(400).json({ erro: 'time_casa, time_fora e rodada são obrigatórios.' });
    }

    // Evita duplicata pelo fixture_id externo
    if (fixture_id) {
      const jaExiste = await pool.query(
        'SELECT id_jogo FROM jogos WHERE fixture_id_externo = $1',
        [fixture_id]
      );
      if (jaExiste.rows.length > 0) {
        return res.status(409).json({ erro: 'Este jogo já foi importado.', id_jogo: jaExiste.rows[0].id_jogo });
      }
    }

    // Converte data para UTC mantendo horário de Brasília
    let data_jogo_utc = null;
    if (data_jogo) {
      data_jogo_utc = new Date(data_jogo).toISOString();
    }

    const resultado = await pool.query(
      `INSERT INTO jogos (time_casa, time_fora, status, rodada, data_jogo, fixture_id_externo)
       VALUES ($1, $2, 'andamento', $3, $4, $5) RETURNING *`,
      [time_casa, time_fora, Number(rodada), data_jogo_utc, fixture_id || null]
    );

    res.status(201).json({
      mensagem: `${time_casa} x ${time_fora} importado com sucesso!`,
      jogo: resultado.rows[0]
    });
  } catch (err) {
    console.error('Erro ao importar jogo:', err.message);
    res.status(500).json({ erro: 'Erro ao importar jogo para o banco.' });
  }
});

// =============================================================================
// JOB AUTOMÁTICO: CALCULAR PONTOS quando jogo muda para 'finalizado' no banco
// Roda a cada 30 segundos — detecta jogos finalizados que ainda não tiveram
// pontos calculados (pontos_obtidos IS NULL nos palpites)
// =============================================================================
async function calcularPontosAutomaticamente() {
  try {
    // Busca jogos finalizados que ainda têm palpites sem pontuação
    const jogosParaCalcular = await pool.query(`
      SELECT DISTINCT j.id_jogo, j.gols_casa_real, j.gols_fora_real, j.rodada,
                      j.time_casa, j.time_fora
      FROM jogos j
      JOIN palpites p ON p.jogo_id = j.id_jogo
      WHERE j.status = 'finalizado'
        AND j.gols_casa_real IS NOT NULL
        AND j.gols_fora_real IS NOT NULL
        AND p.pontos_obtidos IS NULL
    `);

    if (jogosParaCalcular.rows.length === 0) return;

    for (const jogo of jogosParaCalcular.rows) {
      const { id_jogo, time_casa, time_fora, rodada } = jogo;
      const gols_casa_real = Number(jogo.gols_casa_real);
      const gols_fora_real = Number(jogo.gols_fora_real);

      console.log(`⚽ [AUTO-PONTOS] Calculando: ${time_casa} ${gols_casa_real}x${gols_fora_real} ${time_fora} (Rodada ${rodada})`);

      // Busca todos os palpites desse jogo ainda sem pontuação
      const palpites = await pool.query(
        'SELECT * FROM palpites WHERE jogo_id = $1 AND pontos_obtidos IS NULL',
        [id_jogo]
      );

      for (const palpite of palpites.rows) {
        const gols_casa_palpite = Number(palpite.gols_casa_palpite);
        const gols_fora_palpite = Number(palpite.gols_fora_palpite);
        let pontos = 0;

        if (gols_casa_palpite === gols_casa_real && gols_fora_palpite === gols_fora_real) {
          pontos = 3; // Placar exato
        } else {
          const saldoPalpite = gols_casa_palpite - gols_fora_palpite;
          const saldoReal    = gols_casa_real    - gols_fora_real;
          if (
            (saldoPalpite > 0 && saldoReal > 0) ||
            (saldoPalpite < 0 && saldoReal < 0) ||
            (saldoPalpite === 0 && saldoReal === 0)
          ) {
            pontos = 1; // Acertou vencedor/empate
          }
        }

        await pool.query(
          'UPDATE palpites SET pontos_obtidos = $1 WHERE usuario_id = $2 AND jogo_id = $3',
          [pontos, palpite.usuario_id, id_jogo]
        );
        console.log(`  ✅ usuario=${palpite.usuario_id} | palpite: ${gols_casa_palpite}x${gols_fora_palpite} → ${pontos}pts`);
      }

    } // fim do loop de jogos

    // ✅ CORREÇÃO: verificação de encerramento de ligas FORA do loop de pontos
    // Assim funciona mesmo se alguns jogos não tiverem palpites
    try {
      const ligasAtivas = await pool.query(`
        SELECT id_liga, nome, total_rodadas, rodada_inicial
        FROM ligas WHERE status = 'ativa' AND total_rodadas IS NOT NULL
      `);
      for (const liga of ligasAtivas.rows) {
        const rodadaInicial = Number(liga.rodada_inicial || 1);
        const rodadaFinal   = rodadaInicial + Number(liga.total_rodadas) - 1;
        // Verifica se ainda há jogos não finalizados dentro do intervalo da liga
        const jogosPendentes = await pool.query(`
          SELECT COUNT(*) AS total FROM jogos
          WHERE rodada BETWEEN $1 AND $2 AND status != 'finalizado'
        `, [rodadaInicial, rodadaFinal]);
        if (Number(jogosPendentes.rows[0].total) === 0) {
          // Também verifica se há palpites sem pontuação ainda (pontos podem estar sendo calculados)
          const palpitesPendentes = await pool.query(`
            SELECT COUNT(*) AS total FROM palpites p
            JOIN jogos j ON j.id_jogo = p.jogo_id
            WHERE j.rodada BETWEEN $1 AND $2
              AND j.status = 'finalizado'
              AND p.pontos_obtidos IS NULL
          `, [rodadaInicial, rodadaFinal]);
          if (Number(palpitesPendentes.rows[0].total) === 0) {
            const resumo = await gerarResumoLiga(liga.id_liga);
            await pool.query(
              `UPDATE ligas SET status = 'encerrada', data_encerramento = NOW(), resumo_encerramento = $1 WHERE id_liga = $2`,
              [JSON.stringify(resumo), liga.id_liga]
            );
            console.log(`🏆 Liga "${liga.nome}" (ID ${liga.id_liga}) encerrada automaticamente.`);
          }
        }
      }
    } catch (e) {
      console.error('Aviso: erro no encerramento automático de ligas:', e.message);
    }

  } catch (err) {
    console.error('Erro no job de pontuação automática:', err.message);
  }
}

// Dispara ao subir e a cada 30 segundos
calcularPontosAutomaticamente();
setInterval(calcularPontosAutomaticamente, 30 * 1000);








// =========================================================================
// ROTA: DESEMPENHO POR RODADA DE CADA MEMBRO DE UMA LIGA
// GET /desempenho-rodadas/:liga_id
// Retorna: para cada rodada que teve jogos, os pontos de cada membro
// =========================================================================
app.get('/desempenho-rodadas/:liga_id', async (req, res) => {
  try {
    const { liga_id } = req.params;

    // Busca todos os palpites dos membros da liga, agrupados por usuário e rodada
    const resultado = await pool.query(`
      SELECT
        u.id                                                      AS usuario_id,
        u.nome,
        u.foto_perfil,
        j.rodada,
        COALESCE(SUM(p.pontos_obtidos), 0)                        AS pontos_rodada,
        COUNT(p.id_palpite) FILTER (WHERE p.pontos_obtidos = 3)   AS acertos_exatos,
        COUNT(p.id_palpite) FILTER (WHERE p.pontos_obtidos = 1)   AS acertos_resultado,
        COUNT(p.id_palpite) FILTER (WHERE p.pontos_obtidos = 0
                                      AND p.pontos_obtidos IS NOT NULL) AS erros,
        COUNT(p.id_palpite) FILTER (WHERE p.pontos_obtidos IS NOT NULL) AS jogos_finalizados,
        COUNT(p.id_palpite)                                        AS total_palpites,
        -- status da rodada: se algum jogo ainda não foi finalizado, está em andamento
        BOOL_AND(j.status = 'finalizado')                          AS rodada_finalizada
      FROM usuarios u
      JOIN usuarios_ligas ul ON ul.usuario_id = u.id
      LEFT JOIN palpites p   ON p.usuario_id = u.id
      LEFT JOIN jogos j      ON j.id_jogo = p.jogo_id
      WHERE ul.liga_id = $1
        AND j.rodada IS NOT NULL
      GROUP BY u.id, u.nome, u.foto_perfil, j.rodada
      ORDER BY j.rodada ASC, pontos_rodada DESC
    `, [liga_id]);

    // Organiza: { rodada -> [membros com pontos] }
    const porRodada = {};
    for (const row of resultado.rows) {
      const r = row.rodada;
      if (!porRodada[r]) porRodada[r] = { rodada: r, finalizada: true, membros: [] };
      if (!row.rodada_finalizada) porRodada[r].finalizada = false;
      porRodada[r].membros.push({
        usuario_id:        row.usuario_id,
        nome:              row.nome,
        foto_perfil:       row.foto_perfil,
        pontos_rodada:     Number(row.pontos_rodada),
        acertos_exatos:    Number(row.acertos_exatos),
        acertos_resultado: Number(row.acertos_resultado),
        erros:             Number(row.erros),
        jogos_finalizados: Number(row.jogos_finalizados),
        total_palpites:    Number(row.total_palpites),
      });
    }

    // Ordena membros dentro de cada rodada por pontos DESC
    Object.values(porRodada).forEach(r => {
      r.membros.sort((a, b) => b.pontos_rodada - a.pontos_rodada);
    });

    res.json({ rodadas: Object.values(porRodada) });
  } catch (err) {
    console.error('Erro ao buscar desempenho por rodada:', err);
    res.status(500).json({ erro: 'Erro ao buscar desempenho por rodada.' });
  }
});

// =========================================================================
// ROTA: ENCERRAR LIGA MANUALMENTE (dono ou admin)
// =========================================================================
app.post('/encerrar-liga', async (req, res) => {
  try {
    const { liga_id, usuario_id } = req.body;
    if (!liga_id || !usuario_id) return res.status(400).json({ erro: 'liga_id e usuario_id são obrigatórios.' });

    // Verifica se o usuário é dono da liga
    const ligaRes = await pool.query('SELECT * FROM ligas WHERE id_liga = $1', [liga_id]);
    if (ligaRes.rows.length === 0) return res.status(404).json({ erro: 'Liga não encontrada.' });
    const liga = ligaRes.rows[0];

    if (String(liga.dono_id) !== String(usuario_id)) {
      return res.status(403).json({ erro: 'Apenas o dono da liga pode encerrá-la.' });
    }
    if (liga.status === 'encerrada') {
      return res.status(400).json({ erro: 'Liga já está encerrada.' });
    }

    // Gera o resumo
    const resumo = await gerarResumoLiga(liga_id);

    // Salva status encerrada + resumo
    await pool.query(
      `UPDATE ligas SET status = 'encerrada', data_encerramento = NOW(), resumo_encerramento = $1 WHERE id_liga = $2`,
      [JSON.stringify(resumo), liga_id]
    );

    res.json({ mensagem: 'Liga encerrada com sucesso!', resumo });
  } catch (err) {
    console.error('Erro ao encerrar liga:', err);
    res.status(500).json({ erro: 'Erro interno ao encerrar liga.' });
  }
});

// =========================================================================
// ROTA: BUSCAR RESUMO DE UMA LIGA ENCERRADA
// =========================================================================
app.get('/resumo-liga/:liga_id', async (req, res) => {
  try {
    const { liga_id } = req.params;
    const ligaRes = await pool.query('SELECT resumo_encerramento, status, nome FROM ligas WHERE id_liga = $1', [liga_id]);
    if (ligaRes.rows.length === 0) return res.status(404).json({ erro: 'Liga não encontrada.' });
    const { resumo_encerramento, status, nome } = ligaRes.rows[0];
    if (status !== 'encerrada') return res.status(400).json({ erro: 'Liga ainda não foi encerrada.' });
    res.json({ nome, resumo: resumo_encerramento });
  } catch (err) {
    console.error('Erro ao buscar resumo:', err);
    res.status(500).json({ erro: 'Erro interno.' });
  }
});

// =========================================================================
// FUNÇÃO AUXILIAR: GERAR RESUMO ESTATÍSTICO DA LIGA
// =========================================================================
async function gerarResumoLiga(liga_id) {
  // ✅ CORREÇÃO: busca metadados da liga para filtrar por rodadas
  const metaRes = await pool.query('SELECT rodada_inicial, total_rodadas FROM ligas WHERE id_liga = $1', [liga_id]);
  const meta = metaRes.rows[0] || {};
  const rodadaIni = meta.rodada_inicial || 1;
  const rodadaFim = meta.total_rodadas ? rodadaIni + meta.total_rodadas - 1 : 99999;

  // Ranking com pontos totais, acertos exatos e acertos de resultado
  const rankingRes = await pool.query(`
    SELECT
      u.id,
      u.nome,
      u.time_favorito,
      u.foto_perfil,
      COALESCE(SUM(p.pontos_obtidos), 0)                        AS total_pontos,
      COUNT(p.id_palpite) FILTER (WHERE p.pontos_obtidos = 3)   AS acertos_exatos,
      COUNT(p.id_palpite) FILTER (WHERE p.pontos_obtidos = 1)   AS acertos_resultado,
      COUNT(p.id_palpite) FILTER (WHERE p.pontos_obtidos = 0
                                    AND p.pontos_obtidos IS NOT NULL) AS erros,
      COUNT(p.id_palpite) FILTER (WHERE p.pontos_obtidos IS NOT NULL) AS total_palpites
    FROM usuarios u
    JOIN usuarios_ligas ul ON ul.usuario_id = u.id
    LEFT JOIN palpites p ON p.usuario_id = u.id
    LEFT JOIN jogos j ON j.id_jogo = p.jogo_id
      AND j.rodada BETWEEN $2 AND $3
    WHERE ul.liga_id = $1
    GROUP BY u.id, u.nome, u.time_favorito, u.foto_perfil
    ORDER BY total_pontos DESC
  `, [liga_id, rodadaIni, rodadaFim]);

  const ranking = rankingRes.rows;

  // Estatísticas gerais da liga
  const statsRes = await pool.query(`
    SELECT
      COUNT(DISTINCT p.jogo_id)                                             AS total_jogos_palpitados,
      COUNT(p.id_palpite) FILTER (WHERE p.pontos_obtidos = 3)               AS total_acertos_exatos,
      COUNT(p.id_palpite) FILTER (WHERE p.pontos_obtidos IS NOT NULL)        AS total_palpites,
      COALESCE(MAX(sub.pts), 0)                                              AS maior_pontuacao
    FROM palpites p
    JOIN usuarios_ligas ul ON ul.usuario_id = p.usuario_id
    CROSS JOIN (
      SELECT COALESCE(SUM(p2.pontos_obtidos),0) AS pts, p2.usuario_id
      FROM palpites p2
      JOIN usuarios_ligas ul2 ON ul2.usuario_id = p2.usuario_id
      WHERE ul2.liga_id = $1
      GROUP BY p2.usuario_id
    ) sub
    WHERE ul.liga_id = $1
  `, [liga_id]);

  // Rodada com mais pontos no geral
  const rodadaMaisAtivaRes = await pool.query(`
    SELECT j.rodada, SUM(p.pontos_obtidos) AS pontos_rodada
    FROM palpites p
    JOIN jogos j ON j.id_jogo = p.jogo_id
    JOIN usuarios_ligas ul ON ul.usuario_id = p.usuario_id
    WHERE ul.liga_id = $1 AND p.pontos_obtidos IS NOT NULL
    GROUP BY j.rodada
    ORDER BY pontos_rodada DESC
    LIMIT 1
  `, [liga_id]);

  const campeao   = ranking[0] || null;
  const viceCampeao = ranking[1] || null;
  const terceiro  = ranking[2] || null;
  const stats     = statsRes.rows[0] || {};
  const rodadaQuente = rodadaMaisAtivaRes.rows[0] || null;

  return {
    gerado_em: new Date().toISOString(),
    total_participantes: ranking.length,
    campeao,
    vice_campeao: viceCampeao,
    terceiro_lugar: terceiro,
    ranking,
    stats: {
      total_palpites: Number(stats.total_palpites) || 0,
      total_acertos_exatos: Number(stats.total_acertos_exatos) || 0,
      total_jogos_palpitados: Number(stats.total_jogos_palpitados) || 0,
      maior_pontuacao: Number(stats.maior_pontuacao) || 0,
      rodada_mais_disputada: rodadaQuente ? { rodada: rodadaQuente.rodada, pontos: Number(rodadaQuente.pontos_rodada) } : null
    }
  };
}

//--------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando bem demais na porta ${PORT}`);

});