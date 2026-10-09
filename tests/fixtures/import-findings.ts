// Synthetic 29-finding regression batch mirrors the live kind distribution,
// without copying any private source conversation.
export const findings29 = {
  import_key:'synthetic_29',batch_key:'one',target_display_name:'Synthetic 29',
  source:{kind:'whatsapp_txt',name:'Synthetic acceptance fixture'},
  findings:[
    {key:'budget_early',kind:'fact',summary:'Earlier USD ceiling.',evidence:'explicit',source_date:'May 2024',source_quote:'USD 165000',source_speaker:'Haim',
      fact:{category:'requirement',key:'budget_max',value:{amount:165000,currency:'USD'}}},
    {key:'budget_ambiguous',kind:'fact',summary:'Later ambiguous budget; currency and scale unknown.',evidence:'uncertain',source_date:'September 2026',source_quote:'2.8',confidence:0.35678,uncertainty:['Currency/scale not confirmed'],
      fact:{category:'requirement',key:'budget_max',value:{state:'unknown'}}},
    ...Array.from({length:17},(_,i)=>({key:`fact_${i}`,kind:'fact',summary:`Historical preference ${i}`,evidence:i%2?'agent_reported':'inferred',
      ...(i===0?{occurred_at:'2024-06-01T10:00:00Z'}:i===1?{}:{source_date:'2024–2026'}),
      fact:{category:'preference',key:`preference_${i}`,value:i%2===0}})),
    ...Array.from({length:6},(_,i)=>({key:`property_${i}`,kind:'property_discussion',summary:`Unresolved discussed property ${i}`,evidence:'agent_reported',source_date:'2026-10',details:{verification:'unverified'}})),
    ...Array.from({length:2},(_,i)=>({key:`interaction_${i}`,kind:'interaction',summary:`Historical contact ${i}`,evidence:'explicit'})),
    ...Array.from({length:2},(_,i)=>({key:`followup_${i}`,kind:'proposed_action',summary:`Tentative follow-up ${i}`,evidence:'uncertain'})),
  ],limitations:['Synthetic source; proposed actions and historical criteria are not current commitments.'],
};
