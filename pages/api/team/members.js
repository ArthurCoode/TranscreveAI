import supabase from "../../../lib/supabase";
import { autenticarReq } from "../../../lib/auth";

export default async function handler(
req,
res
){

if(req.method!=="GET"){
return res.status(405).json({
erro:"Método não permitido"
});
}

try{

const auth=
await autenticarReq(
req,
res
);

if(!auth)
return;

const {
data:me,
error:meError
}
=
await supabase
.from("usuarios")
.select("team_id")
.eq("id",auth.id)
.maybeSingle();

if(meError)
throw meError;

if(!me?.team_id){

return res
.status(200)
.json([]);

}

const {
data,
error
}
=
await supabase
.from("usuarios")
.select(`
id,
nome,
email,
role
`)
.eq(
"team_id",
me.team_id
);

if(error)
throw error;

return res
.status(200)
.json(

data.map(
u=>({

id:u.id,
name:u.nome,
email:u.email,
role:u.role,

meetings:0,
hours:0,
insights:0

})

)

);

}

catch(err){

console.error(
"TEAM MEMBERS",
err
);

return res
.status(500)
.json({

erro:
err.message

});

}

}