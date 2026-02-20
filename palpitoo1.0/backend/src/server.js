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

// ROTA DE CADASTRO 
app.post('/cadastro', async (req, res) => {
  try {
    const { nome, email, senha, time_favorito, foto_perfil } = req.body; // Pega os 4 dados do site

    // Comando SQL para inserir no banco [cite: 42, 54]
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

// ROTA PARA BUSCAR OS JOGOS DISPONÍVEIS
app.get('/jogos', async (req, res) => {
  try {
    // Busca os jogos, ordenando pela data ou ID (para ficar organizado na tela)
    const resultado = await pool.query('SELECT * FROM jogos ORDER BY id_jogo ASC');
    
    // Devolve a lista de jogos no formato JSON
    res.json(resultado.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao buscar os jogos no banco de dados.' });
  }
});


// ROTA PARA SALVAR OU ATUALIZAR OS PALPITES
app.post('/palpites', async (req, res) => {
  try {
    const { palpites } = req.body; // Pega a "caixa" cheia de palpites que o HTML enviou

    // Passa por cada palpite da caixa e salva no banco
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


// ROTA PARA BUSCAR OS PALPITES SALVOS DE UM USUÁRIO
app.get('/meus-palpites/:id_usuario', async (req, res) => {
  try {
    const { id_usuario } = req.params; // Pega o ID que vem na URL

    const resultado = await pool.query(
      'SELECT * FROM palpites WHERE usuario_id = $1',
      [id_usuario]
    );

    res.json(resultado.rows); // Devolve a lista de palpites desse cara
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao buscar os palpites do usuário.' });
  }
});



const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando bem demais na porta ${PORT}`);
});

//-----------------------------------------------------------------------------
// ROTA DE LOGIN
app.post('/login', async (req, res) => {
  try {
    const { email, senha } = req.body;

    // 1. Procurar o usuário pelo e-mail
    const resultado = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);

    // 2. Se não achar ninguém, para por aqui
    if (resultado.rows.length === 0) {
      return res.status(401).json({ erro: 'E-mail ou senha incorretos.' });
    }

    const usuario = resultado.rows[0];

    // 3. Verificar se a senha bate (Por enquanto estamos comparando texto puro)
    if (usuario.senha !== senha) {
      return res.status(401).json({ erro: 'E-mail ou senha incorretos.' });
    }

    // 4. Se chegou aqui, deu tudo certo!
        res.json({
          mensagem: 'Login bem-sucedido!',
          usuario: { 
            id: usuario.id, 
            nome: usuario.nome, 
            email: usuario.email, 
            time: usuario.time_favorito,
            foto: usuario.foto_perfil // 
          }
        });

  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro interno no servidor.' });
  }
});

// ROTA PARA ATUALIZAR A FOTO DE PERFIL
app.put('/atualizar-foto', async (req, res) => {
  try {
    const { email, foto_base64 } = req.body;

    // Atualiza a coluna foto_perfil onde o email for igual ao do usuário logado
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

