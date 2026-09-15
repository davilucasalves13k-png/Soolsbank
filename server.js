const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const admin = require('firebase-admin');

// Inicializa o Firebase (Certifique-se de configurar suas credenciais no Render)
try {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: "server-180m"
  });
} catch (e) {
  console.log("Aviso Firebase:", e.message);
}

const db = admin.firestore ? admin.firestore() : null;
const app = express();
const server = http.createServer(app);

// IMPORTANTE: Libera o CORS para o Socket.io não travar "Conectando..."
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Banco temporário em memória caso o Firestore demore ou falhe na inicialização
let memoriaContas = {
    "conta_1": { nome: "Usuário Teste", saldo: 100.00, suspensa: false }
};

async function obterContas() {
    if (!db) return memoriaContas;
    try {
        const snapshot = await db.collection('contas').get();
        let contas = {};
        snapshot.forEach(doc => { contas[doc.id] = doc.data(); });
        if (Object.keys(contas).length === 0) {
            return memoriaContas;
        }
        return contas;
    } catch (err) {
        return memoriaContas;
    }
}

io.on('connection', async (socket) => {
    console.log(`[CONEXÃO] Cliente conectado: ${socket.id}`);
    
    let contas = await obterContas();
    socket.emit('atualizar_saldos', contas);

    // Cadastrar nova conta com R$ 100 de bônus
    socket.on('cadastrar_conta', async (dados) => {
        const nome = dados && dados.nome ? dados.nome.trim() : "Novo Usuário";
        const novoId = "conta_" + Math.random().toString(36).substring(2, 8);
        
        const novaConta = {
            nome: nome,
            saldo: 100.00,
            suspensa: false
        };

        if (db) {
            await db.collection('contas').doc(novoId).set(novaConta);
        } else {
            memoriaContas[novoId] = novaConta;
        }

        let atualizadas = await obterContas();
        io.emit('atualizar_saldos', atualizadas);
        io.emit('log_mensagem', `[SUCESSO] Conta de ${nome} criada com R$ 100,00 de bônus!`);
    });

    // Realizar Transferência P2P
    socket.on('realizar_transferencia', async (dados) => {
        const { origem, destino, valor } = dados;
        let contas = await obterContas();

        if (!contas[origem] || !contas[destino]) {
            socket.emit('erro_transacao', 'Conta de origem ou destino inválida.');
            return;
        }

        if (contas[origem].suspensa || contas[destino].suspensa) {
            socket.emit('erro_transacao', '⚠️ Operação negada: Conta suspensa pelo Dono!');
            return;
        }

        const quantia = parseFloat(valor);
        if (isNaN(quantia) || quantia <= 0) {
            socket.emit('erro_transacao', 'Valor inválido.');
            return;
        }

        if (contas[origem].saldo < quantia) {
            socket.emit('erro_transacao', 'Saldo insuficiente.');
            return;
        }

        contas[origem].saldo -= quantia;
        contas[destino].saldo += quantia;

        if (db) {
            await db.collection('contas').doc(origem).update({ saldo: contas[origem].saldo });
            await db.collection('contas').doc(destino).update({ saldo: contas[destino].saldo });
        } else {
            memoriaContas = contas;
        }

        io.emit('atualizar_saldos', contas);
        io.emit('log_mensagem', `[TRANSFERÊNCIA] R$ ${quantia.toFixed(2)} enviados com sucesso!`);
    });

    // Suspensão do Dono
    socket.on('alternar_suspensao', async (contaId) => {
        let contas = await obterContas();
        if (contas[contaId]) {
            const novoStatus = !contas[contaId].suspensa;
            if (db) {
                await db.collection('contas').doc(contaId).update({ suspensa: novoStatus });
            }
            contas[contaId].suspensa = novoStatus;
            io.emit('atualizar_saldos', contas);
            io.emit('log_mensagem', `[DONO] Conta ${contas[contaId].nome} teve o status alterado.`);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
