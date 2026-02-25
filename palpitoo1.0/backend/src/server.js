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
// ROTA PARA SALVAR OU ATUALIZAR OS PALPITES
app.post('/palpites', async (req, res) => {
  try {
    const { palpites } = req.body; 

    for (const p of palpites) {
      await pool.query(
        `INSERT INTO palpites (usuario_id, jogo_id, gols_casa_palpite, gols_fora_palpite) 
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (usuario_id, jogo_id) 
         DO UPDATE SET 
            gols_casa_palpite = EXCLUDED.gols_casa_palpite, 
            gols_fora_palpite = EXCLUDED.gols_fora_palpite`,
        [p.id_usuario, p.id_jogo, p.gols_casa, p.gols_fora]
      );
    }

    res.json({ mensagem: 'Palpites cravados com sucesso!' });
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
// ROTA PARA ENCERRAR O JOGO E CALCULAR OS PONTOS (VERSÃO BLINDADA)
app.post('/encerrar-jogo', async (req, res) => {
  try {
    const { id_jogo, gols_casa_real, gols_fora_real } = req.body;

    // 1. Atualiza o status e placar real do jogo
    await pool.query(
      `UPDATE jogos 
       SET gols_casa_real = $1, gols_fora_real = $2, status = 'finalizado' 
       WHERE id_jogo = $3`,
      [gols_casa_real, gols_fora_real, id_jogo]
    );

    // 2. Busca todos os palpites para esse jogo
    const resultadoPalpites = await pool.query(
      'SELECT * FROM palpites WHERE jogo_id = $1',
      [id_jogo]
    );

    // 3. Calcula os pontos
    for (const palpite of resultadoPalpites.rows) {
      let pontos = 0;
      const { usuario_id, jogo_id, gols_casa_palpite, gols_fora_palpite } = palpite;

      // REGRA 1: Acertou na mosca (Placar exato) = 3 pontos
      if (gols_casa_palpite === gols_casa_real && gols_fora_palpite === gols_fora_real) {
        pontos = 3;
      } 
      // REGRA 2: Não acertou o placar, mas acertou o vencedor ou empate
      else {
        const saldoPalpite = gols_casa_palpite - gols_fora_palpite;
        const saldoReal = gols_casa_real - gols_fora_real;

        if (
          (saldoPalpite > 0 && saldoReal > 0) ||   // Casa ganhou
          (saldoPalpite < 0 && saldoReal < 0) ||   // Fora ganhou
          (saldoPalpite === 0 && saldoReal === 0)  // Empate
        ) {
          pontos = 1; 
        } else {
          pontos = 0; 
        }
      }

      // 4. Salva a pontuação na tabela (Usando usuario_id e jogo_id)
      await pool.query(
        'UPDATE palpites SET pontos_obtidos = $1 WHERE usuario_id = $2 AND jogo_id = $3',
        [pontos, usuario_id, jogo_id]
      );
    }

    res.json({ mensagem: 'Jogo encerrado e pontos distribuídos com sucesso!' });

  } catch (err) {
    console.error("Erro ao encerrar jogo:", err);
    res.status(500).json({ erro: 'Erro interno ao calcular a pontuação.' });
  }
});

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
    const { nome_liga, id_dono } = req.body;

    // Gera um código aleatório de 6 letras/números (Ex: X7B9KQ)
    const codigo_convite = Math.random().toString(36).substring(2, 8).toUpperCase();

    // 1. Salva a liga nova no banco
    const novaLiga = await pool.query(
      'INSERT INTO ligas (nome, codigo_convite, dono_id) VALUES ($1, $2, $3) RETURNING *',
      [nome_liga, codigo_convite, id_dono]
    );

    const idLigaGerada = novaLiga.rows[0].id_liga;

    // 2. Coloca o dono automaticamente dentro da liga que ele acabou de criar
    await pool.query(
      'INSERT INTO usuarios_ligas (liga_id, usuario_id) VALUES ($1, $2)',
      [idLigaGerada, id_dono]
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
    const { codigo_convite, id_usuario } = req.body;

    // 1. Verifica se a liga com esse código existe
    const buscaLiga = await pool.query('SELECT * FROM ligas WHERE codigo_convite = $1', [codigo_convite]);
    
    if (buscaLiga.rows.length === 0) {
      return res.status(404).json({ erro: 'Liga não encontrada. Verifique o código!' });
    }

    const liga_id = buscaLiga.rows[0].id_liga;

    // 2. Tenta colocar o usuário na liga
    await pool.query(
      'INSERT INTO usuarios_ligas (liga_id, usuario_id) VALUES ($1, $2)',
      [liga_id, id_usuario]
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

    // Essa query faz um JOIN para buscar os dados da liga através da tabela ponte
    const resultado = await pool.query(`
      SELECT l.id_liga, l.nome, l.codigo_convite, l.dono_id 
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
// ROTA ADMIN: BUSCAR TODAS AS LIGAS DO SISTEMA
app.get('/todas-ligas', async (req, res) => {
  try {
    // Busca a liga, cruza com a tabela de usuários para pegar o nome do dono, 
    // e ainda conta quantos membros tem lá dentro!
    const resultado = await pool.query(`
      SELECT l.id_liga, l.nome, l.codigo_convite, u.nome AS nome_dono,
             (SELECT COUNT(*) FROM usuarios_ligas ul WHERE ul.liga_id = l.id_liga) as total_membros
      FROM ligas l
      LEFT JOIN usuarios u ON l.dono_id = u.id
      ORDER BY l.id_liga ASC
    `);
    res.json(resultado.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao buscar todas as ligas.' });
  }
});

// -----------------------------------------------------------------------------
// ROTA ADMIN: BUSCAR MEMBROS DE UMA LIGA ESPECÍFICA
app.get('/liga-membros/:id_liga', async (req, res) => {
  try {
    const { id_liga } = req.params;
    const resultado = await pool.query(`
      SELECT u.id, u.nome, u.email, u.time_favorito
      FROM usuarios u
      JOIN usuarios_ligas ul ON u.id = ul.usuario_id
      WHERE ul.liga_id = $1
    `, [id_liga]); 

    res.json(resultado.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao buscar membros da liga.' });
  }
});

// -----------------------------------------------------------------------------
// ROTA ADMIN: CRIAR UM NOVO JOGO// -----------------------------------------------------------------------------
// ROTA ADMIN: CRIAR UM NOVO JOGO (AGORA COM RODADA!)

app.post('/criar-jogo', async (req, res) => {
  try {
    const { time_casa, time_fora, rodada } = req.body;

    if (!time_casa || !time_fora || !rodada) {
      return res.status(400).json({ erro: 'Preencha os times e a rodada!' });
    }

    // Insere no banco agora com a coluna RODADA
    const resultado = await pool.query(
      `INSERT INTO jogos (time_casa, time_fora, status, rodada) 
       VALUES ($1, $2, 'em andamento', $3) RETURNING *`,
      [time_casa, time_fora, rodada]
    );

    res.status(201).json({ 
      mensagem: `Jogo cadastrado na Rodada ${rodada}!`, 
      jogo: resultado.rows[0] 
    });
  } catch (err) {
    console.error("Erro ao criar jogo:", err);
    res.status(500).json({ erro: 'Erro ao cadastrar o jogo no banco de dados.' });
  }
});
// -----------------------------------------------------------------------------
// ROTA PARA BUSCAR O RANKING DE UMA LIGA PRIVADA ESPECÍFICA
app.get('/ranking-liga/:id_liga', async (req, res) => {
  try {
    const { id_liga } = req.params;
    
    // 1. Busca os pontos só da galera que tá nessa liga
    const resultado = await pool.query(`
      SELECT 
        u.id,
        u.nome, 
        u.time_favorito, 
        COALESCE(SUM(p.pontos_obtidos), 0) AS total_pontos
      FROM usuarios u
      JOIN usuarios_ligas ul ON u.id = ul.usuario_id
      LEFT JOIN palpites p ON u.id = p.usuario_id
      WHERE ul.liga_id = $1
      GROUP BY u.id, u.nome, u.time_favorito
      ORDER BY total_pontos DESC
    `, [id_liga]);
    
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
      SELECT l.id_liga, l.nome, l.codigo_convite, l.dono_id
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
      'SELECT * FROM ligas WHERE id_liga = $1',
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

// -----------------------------------------------------------------------------
// ROTA PARA SAIR DE UMA LIGA
app.post('/sair-liga', async (req, res) => {
  try {
    const { id_usuario } = req.body;
    await pool.query(
      'DELETE FROM usuarios_ligas WHERE usuario_id = $1',
      [id_usuario]
    );
    res.json({ mensagem: 'Você saiu da liga com sucesso.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao sair da liga.' });
  }
});

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

//--------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando bem demais na porta ${PORT}`);
});