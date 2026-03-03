import {tool , RunContext} from "@openai/agents";
import {z} from "zod";
import type { AppContext } from "../context/app.context.js";

interface Resume {
    name: string;
    email: string;
    skills: string;
    years_of_experience: number;
    education: string;
}

export const fetchResumeTool = tool({
    name:"fetch_resume",
    description:"Fetch's users resume from database.",
    parameters:z.object({}),
    execute:async(_ ,ctx?:RunContext<AppContext>)=>{

        if(!ctx?.context.userId)
        {
            throw new Error("UNAUTHORIZED");
        }
        //fetch resume from db
        const resume = ctx.context.db.prepare("SELECT * FROM  resumes WHERE user_id=?")
        .get(ctx.context.userId) as Resume | undefined;
        if(!resume)
        {
            return null;
        }
        console.log("DEBUG: Fetched Resume from DB:", resume);
       return {
      name: resume?.name,
      email: resume.email,
      skills: JSON.parse(resume.skills),
      yearsOfExperience: resume.years_of_experience,
      education: JSON.parse(resume.education)
    };
        

    }
})