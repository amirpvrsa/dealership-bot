function calculateCreditScore(rating) {
  if (!rating) return 0;
  
  const ratingLower = rating.toLowerCase();
  if (ratingLower.includes('excellent') || ratingLower === '750+') return 3;
  if (ratingLower.includes('good') || ratingLower === '700-749') return 2.5;
  if (ratingLower.includes('fair') || ratingLower === '650-699') return 1.5;
  if (ratingLower.includes('poor') || ratingLower === '550-649') return 0.5;
  if (ratingLower.includes('bad') || ratingLower === '<550') return 0;
  
  // Try to parse as number
  const numRating = parseInt(rating.replace(/\D/g, ''));
  if (!isNaN(numRating)) {
    if (numRating >= 750) return 3;
    if (numRating >= 700) return 2.5;
    if (numRating >= 650) return 1.5;
    if (numRating >= 550) return 0.5;
    return 0;
  }
  
  return 0;
}

function calculateEmploymentScore(status) {
  if (!status) return 0;
  
  const statusLower = status.toLowerCase();
  if (statusLower.includes('employed')) return 2;
  if (statusLower.includes('self-employed') || statusLower.includes('self employed')) return 1.5;
  return 0.5;
}

function calculateIncomeScore(income) {
  if (!income) return 0;
  
  // Extract numeric value from income string
  const numIncome = parseFloat(income.toString().replace(/[^0-9.]/g, ''));
  if (isNaN(numIncome)) return 0;
  
  // Assume monthly income
  if (numIncome > 5000) return 2;
  if (numIncome >= 3000) return 1.5;
  if (numIncome >= 1500) return 1;
  return 0.5;
}

function calculateHousingScore(housing) {
  if (!housing) return 0;
  
  const housingLower = housing.toLowerCase();
  if (housingLower.includes('own')) return 1;
  if (housingLower.includes('rent')) return 0.5;
  return 0;
}

function calculateIncomeDurationScore(duration) {
  if (!duration) return 0;
  
  const durationLower = duration.toLowerCase();
  
  // Try to extract years
  const yearsMatch = duration.match(/(\d+)\s*years?/i);
  if (yearsMatch) {
    const years = parseInt(yearsMatch[1]);
    if (years > 3) return 2;
    if (years >= 1) return 1.5;
  }
  
  // Check for months
  if (durationLower.includes('6-12') || durationLower.includes('6 to 12')) return 1;
  if (durationLower.includes('<6') || durationLower.includes('less than 6')) return 0.5;
  
  // Default to middle score if unclear
  return 1;
}

function calculateScore(formProperties) {
  const scores = {
    credit: calculateCreditScore(formProperties.Estimated_Credit_Rating),
    employment: calculateEmploymentScore(formProperties.Employment_Status),
    income: calculateIncomeScore(formProperties.Your_monthly_income),
    housing: calculateHousingScore(formProperties.Rent_Own_None_a_House),
    incomeDuration: calculateIncomeDurationScore(formProperties.How_long_have_you_been_receiving_this_income)
  };

  const totalScore = scores.credit + scores.employment + scores.income + scores.housing + scores.incomeDuration;

  let emoji, label;
  if (totalScore < 4) {
    emoji = '🔴';
    label = 'Weak file';
  } else if (totalScore < 7) {
    emoji = '🟡';
    label = 'Workable file';
  } else {
    emoji = '🟢';
    label = 'Strong file';
  }

  return {
    score: totalScore,
    emoji,
    label,
    breakdown: scores
  };
}

module.exports = {
  calculateScore
};
