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
  ssl: true // Ativa o SSL explicitamente
});

// linha global (só para testar):
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

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
// LIGA O MOTOR! (Sempre deve ficar no final do arquivo)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando bem demais na porta ${PORT}`);
});