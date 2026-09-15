const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Servir arquivos estáticos (HTML da interface)
app.use(express.static(path.join(__dirname, 'public')));

// Banco de dados em memória para as contas ativas no Soolsapp
let contas = {
    "conta_A": { nome: "Conta Origem #1", saldo: 1500.00, suspensa: false },
    "conta_B": { nome: "Conta Destino #2", saldo: 350.00, suspensa: false }
};

io.on('connection', (socket) => {
    console.log(`[CONEXÃO] Cliente conectado: ${socket.id}`);

    // Envia o estado atual das contas assim que o cliente entra
    socket.emit('atualizar_saldos', contas);

    // Evento de Transferência (Ida e Volta) via Socket.IO
    socket.on('realizar_transferencia', (dados) => {
        const { origem, destino, valor } = dados;

        // Verifica se as contas existem
        if (!contas[origem] || !contas[destino]) {
            socket.emit('erro_transacao', 'Conta de origem ou destino inválida.');
            return;
        }

        // Verifica se alguma das contas foi suspensa pelo Dono
        if (contas[origem].suspensa || contas[destino].suspensa) {
            socket.emit('erro_transacao', '⚠️ Operação negada: Uma das contas envolvidas está SUSPENSA pelo Dono do sistema!');
            return;
        }

        const quantia = parseFloat(valor);
        if (isNaN(quantia) || quantia <= 0) {
            socket.emit('erro_transacao', 'Valor de transferência inválido.');
            return;
        }

        if (contas[origem].saldo < quantia) {
            socket.emit('erro_transacao', 'Saldo insuficiente para realizar a operação.');
            return;
        }

        // Executa a movimentação do dinheiro em tempo real
        contas[origem].saldo -= quantia;
        contas[destino].saldo += quantia;

        // Dispara a atualização para TODOS os clientes conectados instantaneamente
        io.emit('atualizar_saldos', contas);
        io.emit('log_mensagem', `[SUCESSO] R$ ${quantia.toFixed(2)} transferidos de ${contas[origem].nome} para ${contas[destino].nome}.`);
    });

    // Evento onde o Dono aplica suspensão em uma conta por comportamento suspeito
    socket.on('alternar_suspensao', (contaId) => {
        if (contas[contaId]) {
            contas[contaId].suspensa = !contas[contaId].suspensa;
            const statusStr = contas[contaId].suspensa ? "SUSPENSA PELO DONO 🚫" : "REATIVADA ✅";
            
            io.emit('atualizar_saldos', contas);
            io.emit('log_mensagem', `[ALERTA DO DONO] A conta ${contas[contaId].nome} agora está: ${statusStr}`);
        }
    });

    socket.on('disconnect', () => {
        console.log(`[DESCONEXÃO] Cliente desconectado: ${socket.id}`);
    });
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Servidor Soolsapp Socket.IO rodando na porta ${PORT}`);
    console.log(`Acesse: http://localhost:${PORT}`);
});
