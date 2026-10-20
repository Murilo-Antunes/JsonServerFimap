const jsonServer = require('json-server');
const server = jsonServer.create();
const router = jsonServer.router('db.json');
const middlewares = jsonServer.defaults();

// O Render injeta automaticamente a porta correta nesta variável
const port = process.env.PORT || 3000; 

server.use(middlewares);
server.use(router);

server.listen(port, () => {
    console.log(`JSON Server está rodando na porta ${port}`);
});