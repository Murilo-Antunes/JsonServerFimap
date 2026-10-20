
const express = require('express')
const { create, router } = require('json-server')

const app = express()
const jsonServer = create()
const dbRouter = router('db.json')

app.use(express.json())

// Rotas personalizadas entram aqui,
// antes do roteador genérico.

// Rotas CRUD geradas pelo JSON Server
app.use('/api/v1', dbRouter)

const PORT = process.env.PORT || 3001

app.listen(PORT, '0.0.0.0', () => {
  console.log(`FIMAP Mock API rodando na porta ${PORT}`)
})
