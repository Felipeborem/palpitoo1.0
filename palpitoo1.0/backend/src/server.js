// 1. Puxamos as ferramentas que instalamos
require('dotenv').config(); // Abre o cofre (.env)
const express = require('express'); // Chama o garçom
const cors = require('cors'); // Chama o porteiro
const { Pool } = require('pg'); // Pega a chave do banco

// 2. Criamos o nosso app
const app = express();
app.use(cors()); // Libera a porta pro site
app.use(express.json()); // Ensina o garçom a entender o formato JSON (que o site vai enviar)

// 3. Conectando no Supabase usando a URL do seu cofre
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// 4. Rota de teste (Vamos ver se o garçom está vivo)
app.get('/', (req, res) => {
  res.send('O garçom do Palpitoo está online e pronto para anotar os pedidos!');
});

// 5. Ligando o servidor na tomada
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando lindamente na porta ${PORT}`);
});