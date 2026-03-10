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
// ROTA PARA ENCERRAR O JOGO E CALCULAR OS PONTOS (VERSÃO BLINDADA)
app.post('/encerrar-jogo', async (req, res) => {
  try {
    // ✅ CORREÇÃO: Converter TODOS os valores para número (req.body envia strings)
    const id_jogo        = Number(req.body.id_jogo);
    const gols_casa_real = Number(req.body.gols_casa_real);
    const gols_fora_real = Number(req.body.gols_fora_real);

    console.log(`🔧 Encerrando jogo ${id_jogo} | Placar real: ${gols_casa_real} x ${gols_fora_real}`);

    // 1. Atualiza o status e placar real do jogo
    const jogoUpdate = await pool.query(
      `UPDATE jogos 
       SET gols_casa_real = $1, gols_fora_real = $2, status = 'finalizado' 
       WHERE id_jogo = $3`,
      [gols_casa_real, gols_fora_real, id_jogo]
    );
    console.log(`✅ Jogo ${id_jogo} atualizado no banco. Rows afetadas: ${jogoUpdate.rowCount}`);

    // 2. Busca todos os palpites para esse jogo
    const resultadoPalpites = await pool.query(
      'SELECT * FROM palpites WHERE jogo_id = $1',
      [id_jogo]
    );
    console.log(`📋 Palpites encontrados para jogo ${id_jogo}: ${resultadoPalpites.rows.length}`);

    // 3. Calcula os pontos
    for (const palpite of resultadoPalpites.rows) {
      let pontos = 0;
      const { usuario_id, jogo_id } = palpite;
      // ✅ CORREÇÃO: Garantir que os valores do banco também são números
      const gols_casa_palpite = Number(palpite.gols_casa_palpite);
      const gols_fora_palpite = Number(palpite.gols_fora_palpite);
      console.log(`👤 usuario=${usuario_id} | palpite: ${gols_casa_palpite}x${gols_fora_palpite} | real: ${gols_casa_real}x${gols_fora_real}`);

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
      const pontosUpdate = await pool.query(
        'UPDATE palpites SET pontos_obtidos = $1 WHERE usuario_id = $2 AND jogo_id = $3',
        [pontos, usuario_id, jogo_id]
      );
      console.log(`💾 Pontos salvos: ${pontos}pts para usuario=${usuario_id} no jogo=${jogo_id} | Rows afetadas: ${pontosUpdate.rowCount}`);
    }

// ── AUTO-BLOQUEIO ──
    try {
      const jogoInfo = await pool.query('SELECT rodada FROM jogos WHERE id_jogo = $1', [id_jogo]);
      if (jogoInfo.rows.length > 0) {
        const rodada = jogoInfo.rows[0].rodada;
        const pendentes = await pool.query(
          `SELECT COUNT(*) AS total FROM jogos WHERE rodada = $1 AND status != 'finalizado'`,
          [rodada]
        );
        if (Number(pendentes.rows[0].total) === 0) {
          // Todos os jogos da rodada finalizados → bloqueia automaticamente
          const rodadaExiste = await pool.query('SELECT rodada FROM prazos_rodadas WHERE rodada = $1', [rodada]);
          if (rodadaExiste.rows.length > 0) {
            await pool.query('UPDATE prazos_rodadas SET bloqueada = true WHERE rodada = $1', [rodada]);
          } else {
            await pool.query('INSERT INTO prazos_rodadas (rodada, prazo_limite, bloqueada) VALUES ($1, NOW(), true)', [rodada]);
          }
          console.log(`✅ Rodada ${rodada} bloqueada automaticamente (todos os jogos finalizados).`);

          // ── VERIFICA SE ALGUMA LIGA DEVE SER ENCERRADA AUTOMATICAMENTE ──
          try {
            const ligasAtivas = await pool.query(`
              SELECT id_liga, nome, total_rodadas, rodada_inicial
              FROM ligas
              WHERE status = 'ativa'
                AND total_rodadas IS NOT NULL
            `);
            for (const liga of ligasAtivas.rows) {
              const rodadaInicial = liga.rodada_inicial || 1;
              const rodadaFinal   = rodadaInicial + liga.total_rodadas - 1;
              if (rodada >= rodadaFinal) {
                // Verifica se todos os jogos das rodadas da liga foram finalizados
                const jogosPendentes = await pool.query(`
                  SELECT COUNT(*) AS total FROM jogos
                  WHERE rodada BETWEEN $1 AND $2 AND status != 'finalizado'
                `, [rodadaInicial, rodadaFinal]);
                if (Number(jogosPendentes.rows[0].total) === 0) {
                  const resumo = await gerarResumoLiga(liga.id_liga);
                  await pool.query(
                    `UPDATE ligas SET status = 'encerrada', data_encerramento = NOW(), resumo_encerramento = $1 WHERE id_liga = $2`,
                    [JSON.stringify(resumo), liga.id_liga]
                  );
                  console.log(`🏆 Liga "${liga.nome}" (ID ${liga.id_liga}) encerrada automaticamente após rodada ${rodada}.`);
                }
              }
            }
          } catch (ligaErr) {
            console.error('Aviso: erro na verificação automática de ligas:', ligaErr);
          }
        }
      }
    } catch (autoErr) {
      console.error("Aviso: erro no auto-bloqueio da rodada:", autoErr);
    }

    // ✅ CORREÇÃO: res.json enviado apenas após todo o processamento terminar
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
    const { time_casa, time_fora, rodada, data_jogo } = req.body;

    if (!time_casa || !time_fora || !rodada) {
      return res.status(400).json({ erro: 'Preencha os times e a rodada!' });
    }

    // NOVA CONVERSÃO DE DATA: Blindada contra erros de fuso horário
    let data_jogo_utc = null;
    if (data_jogo) {
      // Pega o que você digitou (ex: "2026-03-09 18:33")
      const dataLimpa = data_jogo.toString().replace(' ', 'T').trim();
      // Avisa ao Node que esse horário é de Brasília (-03:00) 
      // O .toISOString() cuida de converter perfeitamente para UTC
      data_jogo_utc = new Date(`${dataLimpa}:00.000-03:00`).toISOString();
    }

    const resultado = await pool.query(
      `INSERT INTO jogos (time_casa, time_fora, status, rodada, data_jogo) 
       VALUES ($1, $2, 'andamento', $3, $4) RETURNING *`,
      [time_casa, time_fora, rodada, data_jogo_utc]
    );

    res.status(201).json({ 
      mensagem: `Jogo cadastrado na Rodada ${rodada}${data_jogo ? ` com início em ${data_jogo}` : ''}!`, 
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

// =========================================================================
// ROTA: DEFINIR PRAZO DE PALPITES POR RODADA (ADM)
// =========================================================================
app.post('/definir-prazo-rodada', async (req, res) => {
  try {
    const { rodada, prazo_rodada } = req.body;
    if (!rodada || !prazo_rodada) {
      return res.status(400).json({ erro: 'Informe a rodada e o prazo.' });
    }

    // Usando UPSERT com a nova coluna "status"
    await pool.query(
      `INSERT INTO prazos_rodadas (rodada, prazo_limite, status)
       VALUES ($1, $2, 'aberto')
       ON CONFLICT (rodada)
       DO UPDATE SET prazo_limite = EXCLUDED.prazo_limite, status = 'aberto'`,
      [rodada, prazo_rodada]
    );

    res.json({ mensagem: `Prazo da Rodada ${rodada} definido com sucesso!` });
  } catch (err) {
    console.error("Erro ao definir prazo:", err);
    res.status(500).json({ erro: 'Erro ao salvar prazo no banco.' });
  }
});

// =========================================================================
// ROTA: BLOQUEAR RODADA MANUALMENTE (ADM)
// =========================================================================
app.post('/bloquear-rodada', async (req, res) => {
  try {
    const { rodada, status } = req.body; 
    if (!rodada || !status) return res.status(400).json({ erro: 'Informe a rodada e o status (fechado ou finalizado).' });

    await pool.query(
      `INSERT INTO prazos_rodadas (rodada, prazo_limite, status) 
       VALUES ($1, NOW(), $2)
       ON CONFLICT (rodada) 
       DO UPDATE SET status = $2`,
      [rodada, status]
    );
    
    res.json({ mensagem: `Rodada ${rodada} alterada para: ${status}!` });
  } catch (err) {
    console.error("Erro ao alterar status da rodada:", err);
    res.status(500).json({ erro: 'Erro ao alterar status.' });
  }
});

// =========================================================================
// ROTA: LISTAR STATUS DE TODAS AS RODADAS (ADM)
// =========================================================================
app.get('/status-rodadas', async (req, res) => {
  try {
    const resultado = await pool.query(
      `SELECT rodada, prazo_limite, status FROM prazos_rodadas ORDER BY rodada ASC`
    );
    res.json(resultado.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao listar rodadas.' });
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